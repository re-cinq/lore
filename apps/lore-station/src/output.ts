// The station contract's output: NDJSON on stdout, ending with the claude-style
// `{"type":"result", ...}` line the subsystem supervisor already treats as the
// terminal event. The node outcome rides inside it as the LORE_NODE_RESULT
// payload the Floor's parseNodeResult reads back out of Agent.status.output.

import type { NodeResult } from "@re-cinq/lore-assembly-lines";

/**
 * The terminal NDJSON line. A NodeResult (including outcome "failed" — a normal
 * result that routes the failed edge) emits `is_error:false`; pass `null` +
 * an error message for infrastructure failures, which fail the CR itself.
 */
export function resultLine(
  result: NodeResult | null,
  errorMessage?: string,
): string {
  if (!result) {
    return JSON.stringify({
      type: "result",
      is_error: true,
      result: errorMessage ?? "station failed",
    });
  }

  return JSON.stringify({
    type: "result",
    is_error: false,
    result: `LORE_NODE_RESULT: ${JSON.stringify({ outcome: result.outcome, extras: result.extras ?? {} })}`,
  });
}

/** Progress lines for the log sinks (anything non-terminal). */
export function eventLine(message: string): string {
  return JSON.stringify({ type: "log", message });
}
