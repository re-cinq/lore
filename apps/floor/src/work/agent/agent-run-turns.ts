// The full-fidelity, untruncated, 30-day turn projection of the Agent NDJSON sink (specs/turn-level-transcript-store), unconditional (no feature flag) via parseAgentSink's `collectTurns` call-site argument; nothing is re-parsed here, and correlation happens in PgAgentRunTurns.insertBatch instead.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import { parseCarriedRunIdentity } from "@re-cinq/lore-shared/project/run-identity/carried-run-identity.js";
import { redactSecrets } from "@re-cinq/lore-shared";
import type { AgentRunTurnInsert } from "@re-cinq/lore-shared";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";

/** Upper bound on turns one `/api/agent-events` POST may collect; since envelopes are untruncated, count is the only bound, and overflow beyond it is lost, counted as `turn_dropped_cap` (the GCS raw-stream archive that used to catch it retired in #1149). */
export const MAX_RUN_TURNS_PER_BATCH = 10_000;

const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Redact the raw line and refuse it if redaction broke its JSON (a replacement can span a JSON boundary), since one dropped line beats the whole batch's `::jsonb` cast failing. */
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

interface TurnSourceFields {
  taskId: string | null;
  agentCrName: string | null;
  /** The task-turns relay's idempotency key (#1389); pod-produced envelopes carry none, so cluster ingest never dedups. */
  dedupKey: string | null;
}

function turnSourceFields(
  source:
    { task?: unknown; agent?: unknown; turn_key?: unknown } | null | undefined,
): TurnSourceFields {
  return {
    taskId: str(source?.task),
    agentCrName: str(source?.agent),
    dedupKey: str(source?.turn_key),
  };
}

/** One turn from an already-parsed envelope plus its raw line; returns null only when redaction broke the JSON — an unattributed or unrecognized line is still kept, since a fidelity store must not drop what it cannot label. */
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
    ...turnSourceFields(source),
    carried: parseCarriedRunIdentity(source),
    eventType: isRecord(event) ? str(event.type) : null,
    envelope,
  };
}
