// The full-fidelity turn projection of the Agent NDJSON sink
// (specs/turn-level-transcript-store), the third consumer of the SAME single
// pass that already yields the cost rows (agent-events.ts) and the truncated
// run-visualization rows (agent-run-events.ts).
//
// Where the visualization projection exists to be cheap — tool results capped
// at 2048 bytes, tool inputs at 1024, pruned at 14 days — this one exists to be
// complete: the whole `{source, event}` line, untruncated, kept for 90 days and
// queryable with SQL. It is what answers "what exactly did the agent see and
// say at the step that went wrong".
//
// Two properties are load-bearing on this hot path:
//   * NOTHING is re-parsed here. The scanner already yielded the raw line
//     string and already parsed it once; this collector takes both and hands
//     the string straight to the port, which binds it as TEXT and lets
//     Postgres do the only JSON parse that has to happen. One serialization
//     does remain, at the adapter's Postgres boundary: PgAgentRunTurns
//     JSON.stringify()s the whole batch, re-escaping every envelope byte. That
//     is the store's real memory cost with the flag on — see the spec's
//     Consequences for the sizing.
//   * The whole collector is behind LORE_AGENT_TURNS, off by default. With the
//     flag off no turn is built, so the flag costs one env comparison per POST
//     and the store adds no allocation at all.
//
// Correlation is NOT done here — PgAgentRunTurns.insertBatch resolves
// assemblyLineId / nodeId / iteration from agentCrName in the same statement.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import { redactSecrets } from "@re-cinq/lore-shared";
import type { AgentRunTurnInsert } from "@re-cinq/lore-shared";

/** Upper bound on turns one `/api/agent-events` POST may collect, matching the
 *  visualization projection's cap. Turn envelopes are untruncated, so their
 *  COUNT is the only bound available; beyond it collection stops and the raw
 *  stream remains the GCS archive's job. */
export const MAX_RUN_TURNS_PER_BATCH = 10_000;

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

/**
 * Whether the turn store is collecting. Off unless `LORE_AGENT_TURNS` is
 * exactly `1`: the store is non-authoritative until piloted, so every other
 * value — unset, `true`, `0` — leaves the sink exactly as it is today.
 * Read per call rather than latched at module load so a pilot can be flipped
 * by restarting the Floor without a code path that caches the old answer.
 */
export function agentTurnsEnabled(): boolean {
  return process.env.LORE_AGENT_TURNS === "1";
}

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
    eventType: isObject(event) ? str(event.type) : null,
    envelope,
  };
}
