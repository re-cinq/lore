// The full-fidelity turn projection of the Agent NDJSON sink
// (specs/turn-level-transcript-store): one pipeline.agent_run_turns row per
// attributed stream-json line, payload redacted but NOT truncated. Sits at the
// same tee as the cost mapper and the run-viz projection (agent-events.ts) and
// is collected only when the LORE_AGENT_TURNS flag opts the pilot in — the
// projection, the SSE view, and the GCS archive are untouched.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import { redactSecrets } from "@re-cinq/lore-shared";
import type {
  AgentRunTurnInsert,
  AgentRunTurnType,
} from "@re-cinq/lore-shared";

const TURN_TYPES: ReadonlySet<string> = new Set([
  "system",
  "assistant",
  "user",
  "result",
  "log",
]);

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The pilot flag: off unless LORE_AGENT_TURNS opts in. */
export function turnStoreEnabled(flag: string | undefined): boolean {
  return flag === "1" || flag === "true";
}

/**
 * Redact the stream line through the same secret patterns the GCS archive
 * uses. Redaction happens on the serialized form; replacements are plain
 * `[REDACTED:kind]` text, so the JSON stays parseable — but a queryable store
 * raises the stakes of any miss, so an unparseable result is stored as an
 * explicit marker rather than dropped or stored raw.
 */
function redactTurnPayload(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const redacted = redactSecrets(JSON.stringify(event));

  try {
    return JSON.parse(redacted) as Record<string, unknown>;
  } catch {
    return { __redaction_broke_json__: true, type: event.type };
  }
}

/** One turn per attributed stream line of a known kind; null otherwise. */
export function turnFromEnvelope(envelope: unknown): AgentRunTurnInsert | null {
  const { source, event } = unwrapAttribution(envelope);
  const taskId = typeof source?.task === "string" ? source.task : "";

  if (!taskId || !isObject(event)) {
    return null;
  }
  const type = event.type;

  if (typeof type !== "string" || !TURN_TYPES.has(type)) {
    return null;
  }

  return {
    taskId,
    agentCrName: typeof source?.agent === "string" ? source.agent : null,
    eventType: type as AgentRunTurnType,
    payload: redactTurnPayload(event),
  };
}
