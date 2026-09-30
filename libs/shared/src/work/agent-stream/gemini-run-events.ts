import type { AgentRunEventInsert } from "@re-cinq/lore-shared";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";
import { cap, str, toolResultRowOf } from "./agent-run-tool-rows.js";

// gemini-cli's flat dialect (top-level init/message/tool_use/tool_result/error), projected into the rows claude's nested shapes produce.

// User turns are dropped as claude's user text is; prose arrives as `delta` fragments that foldedDelta joins, so a fragment keeps its whitespace.
export function geminiMessageRows(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert>[] {
  const content = str(ev.content) ?? "";
  const delta = ev.delta === true;

  if (ev.role === "user" || !(delta ? content : content.trim())) {
    return [];
  }

  return [{ eventType: "message", summary: cap(content), payload: { delta } }];
}

export function geminiToolResultRows(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert>[] {
  const error = isRecord(ev.error) ? str(ev.error.message) : null;

  return [
    toolResultRowOf({
      id: ev.tool_id,
      isError: ev.status === "error",
      content: str(ev.output) ?? error ?? "",
    }),
  ];
}

export function geminiErrorRows(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert>[] {
  return [
    {
      eventType: "message",
      isError: ev.severity !== "warning",
      summary: cap(str(ev.message) ?? "error"),
      payload: {},
    },
  ];
}

const isDeltaFragment = (row: AgentRunEventInsert): boolean =>
  row.eventType === "message" && row.payload?.delta === true;

const sameStream = (
  previous: AgentRunEventInsert,
  next: AgentRunEventInsert,
): boolean =>
  previous.taskId === next.taskId && previous.agentCrName === next.agentCrName;

const summaryOf = (row: AgentRunEventInsert): string => row.summary ?? "";

/** Joins a gemini prose fragment onto the fragment row right before it, or null when `next` starts its own row. */
export function foldedDelta(
  previous: AgentRunEventInsert | undefined,
  next: AgentRunEventInsert,
): AgentRunEventInsert | null {
  if (!previous || !isDeltaFragment(previous) || !isDeltaFragment(next)) {
    return null;
  }

  return sameStream(previous, next)
    ? {
        ...previous,
        summary: cap(summaryOf(previous) + summaryOf(next)),
      }
    : null;
}
