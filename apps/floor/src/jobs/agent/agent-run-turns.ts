// The full-fidelity turn projection of the Agent NDJSON sink
// (specs/turn-level-transcript-store), the third consumer of the SAME single
// pass that already yields the cost rows (agent-events.ts) and the truncated
// run-visualization rows (agent-run-events.ts).
//
// Where the visualization projection exists to be cheap — tool results capped
// at 2048 bytes, tool inputs at 1024, pruned at 14 days — this one exists to be
// complete: the whole `{source, event}` line, untruncated, kept for 30 days and
// queryable with SQL. It is what answers "what exactly did the agent see and
// say at the step that went wrong".
//
// Collection is UNCONDITIONAL — there is no feature flag. An earlier draft had
// one, for a single-repo pilot; the pilot was dropped, and a flag nobody flips
// is dead code that also leaves the shipping configuration untested. The seam
// that keeps the "turns perturb nothing else" property testable is
// parseAgentSink's `collectTurns` argument, which also drives the cost-only
// path (parseAgentEvents). It is a call-site argument, not an operator switch.
//
// One property is load-bearing on this hot path:
//   * NOTHING is re-parsed here. The scanner already yielded the raw line
//     string and already parsed it once; this collector takes both and hands
//     the string straight to the port, which binds it as TEXT and lets
//     Postgres do the only JSON parse that has to happen. One serialization
//     does remain, at the adapter's Postgres boundary: PgAgentRunTurns
//     JSON.stringify()s the whole batch, re-escaping every envelope byte. That
//     is the store's real memory cost, and with collection unconditional it is
//     paid on every POST — see the spec's Consequences for the sizing.
//
// Correlation is NOT done here — PgAgentRunTurns.insertBatch resolves
// assemblyLineId / nodeId / iteration from agentCrName in the same statement.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import { parseCarriedRunIdentity } from "@re-cinq/lore-shared/project/run-identity/carried-run-identity.js";
import { redactSecrets } from "@re-cinq/lore-shared";
import type { AgentRunTurnInsert } from "@re-cinq/lore-shared";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";

/** Upper bound on turns one `/api/agent-events` POST may collect, matching the
 *  visualization projection's cap. Turn envelopes are untruncated, so their
 *  COUNT is the only bound available; beyond it collection stops and the
 *  overflow is lost — counted as the `turn_dropped_cap` anomaly and warned by
 *  the ingest route (the GCS raw-stream archive that used to catch it was
 *  retired in #1149). */
export const MAX_RUN_TURNS_PER_BATCH = 10_000;

const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/**
 * Redact the raw line, and refuse it if redaction broke its JSON.
 *
 * Redaction is the same control the GCS archive applies, and it matters more
 * here: a queryable store raises a miss from "buried in GCS" to "searchable".
 * But a replacement can in principle span a JSON boundary (the private-key
 * pattern is not anchored inside one string), and an envelope that no longer
 * parses would make the whole batch's `::jsonb` cast fail. Dropping the one
 * line is strictly better than dropping the batch. An untouched line skips the
 * validation entirely, so the common case pays nothing.
 */
function redactedLine(
  rawLine: string,
  redact: (text: string) => string,
): string | null {
  const redacted = redact(rawLine);

  if (redacted === rawLine) {
    return rawLine;
  }

  try {
    JSON.parse(redacted);
  } catch {
    return null;
  }

  return redacted;
}

/**
 * One turn from one already-parsed envelope plus the raw line it was parsed
 * from. Returns null only when redaction broke the line's JSON — an
 * unattributed line, or one of a kind this Floor has never seen, is still a
 * turn, because a store whose point is fidelity must not drop what it cannot
 * label.
 */
export function turnFromEnvelope(
  parsed: unknown,
  rawLine: string,
  redact: (text: string) => string = redactSecrets,
): AgentRunTurnInsert | null {
  const envelope = redactedLine(rawLine, redact);

  if (envelope === null) {
    return null;
  }
  const { source, event } = unwrapAttribution(parsed);

  return {
    taskId: str(source?.task),
    agentCrName: str(source?.agent),
    carried: parseCarriedRunIdentity(source),
    eventType: isRecord(event) ? str(event.type) : null,
    envelope,
    // The task-turns relay's idempotency key (#1389). Only that relay stamps
    // it; pod-produced envelopes carry none, so cluster ingest never dedups.
    dedupKey: str(source?.turn_key),
  };
}
