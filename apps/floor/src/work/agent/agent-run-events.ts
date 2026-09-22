// Run-visualization of Agent NDJSON (#876): NOT gated on ev.usage; correlation in PgAgentRunEvents.insertBatch; truncated payloads, full in agent_run_turns.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import { parseCarriedRunIdentity } from "@re-cinq/lore-shared/project/run-identity/carried-run-identity.js";
import type {
  AgentRunEventInsert,
  AgentRunEventType,
} from "@re-cinq/lore-shared";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";
import {
  cap,
  num,
  str,
  toolCallRow,
  toolResultRowOf,
} from "./agent-run-tool-rows.js";
import {
  geminiErrorRows,
  geminiMessageRows,
  geminiToolResultRows,
} from "./gemini-run-events.js";

function systemRows(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert>[] {
  if (ev.subtype === "init") {
    return [initRow(ev)];
  }
  const hook = hookRow(ev);

  return hook === null ? [] : [hook];
}

function initRow(ev: Record<string, unknown>): Partial<AgentRunEventInsert> {
  const tools = Array.isArray(ev.tools) ? ev.tools.length : 0;

  return {
    eventType: "init",
    summary: cap(`init ${str(ev.model) ?? "unknown"} (${tools} tools)`),
    payload: {},
  };
}

/** A hook's terminal line or null if still running. */
function hookRow(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert> | null {
  const outcome = str(ev.outcome);

  if (typeof ev.hook_id !== "string" || outcome === null) {
    return null;
  }
  const exitCode = num(ev.exit_code);

  return {
    eventType: "hook",
    isError: exitCode !== 0,
    summary: cap(`hook ${str(ev.hook_name) ?? "hook"} ${outcome}`),
    payload: { hookEvent: str(ev.hook_event), outcome, exitCode },
  };
}

// Claude keys the verdict by subtype/is_error; gemini-cli by status, with its duration under stats.
function resultRow(ev: Record<string, unknown>): Partial<AgentRunEventInsert> {
  const subtype = str(ev.subtype) ?? str(ev.status) ?? "unknown";
  const stats = isRecord(ev.stats) ? ev.stats : {};
  const durationMs = num(ev.duration_ms ?? stats.duration_ms);
  const costUsd = num(ev.total_cost_usd);

  return {
    eventType: "result",
    isError: ev.is_error === true || ev.status === "error",
    summary: cap(`result ${subtype} in ${durationMs}ms ($${costUsd})`),
    payload: { subtype, durationMs, costUsd },
  };
}

function assistantRows(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert>[] {
  return contentBlocks(ev).map(assistantBlockRow).filter(isPresent);
}

function contentBlocks(ev: Record<string, unknown>): unknown[] {
  const content = isRecord(ev.message) ? ev.message.content : undefined;

  return Array.isArray(content) ? content : [];
}

function isPresent<T>(row: T | null): row is T {
  return row !== null;
}

function assistantBlockRow(
  block: unknown,
): Partial<AgentRunEventInsert> | null {
  if (!isRecord(block)) {
    return null;
  }

  if (block.type === "text") {
    return textBlockRow(block);
  }

  if (block.type === "thinking") {
    return thinkingBlockRow(block);
  }

  return block.type === "tool_use"
    ? toolCallRow({ name: block.name, id: block.id, input: block.input })
    : null;
}

function textBlockRow(
  block: Record<string, unknown>,
): Partial<AgentRunEventInsert> {
  return {
    eventType: "message",
    summary: cap(str(block.text) ?? ""),
    payload: {},
  };
}

function thinkingBlockRow(
  block: Record<string, unknown>,
): Partial<AgentRunEventInsert> {
  return {
    eventType: "thinking",
    summary: cap(str(block.thinking) ?? ""),
    payload: {},
  };
}

function userRows(ev: Record<string, unknown>): Partial<AgentRunEventInsert>[] {
  return contentBlocks(ev).map(toolResultRow).filter(isPresent);
}

function toolResultRow(block: unknown): Partial<AgentRunEventInsert> | null {
  if (!isRecord(block) || block.type !== "tool_result") {
    return null;
  }

  return toolResultRowOf({
    id: block.tool_use_id,
    isError: block.is_error === true,
    content: toolResultContent(block.content),
  });
}

/** A tool_result's content arrives either as a string or as content blocks. */
function toolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) ? (str(block.text) ?? "") : ""))
      .join("");
  }

  return "";
}

// Station progress lines (agent-output.ts): no claude stream, so progress fills transcript; "message" event type.
function logRows(ev: Record<string, unknown>): Partial<AgentRunEventInsert>[] {
  const message = str(ev.message);

  return message
    ? [{ eventType: "message", summary: cap(message), payload: {} }]
    : [];
}

type EventRowsHandler = (
  ev: Record<string, unknown>,
) => Partial<AgentRunEventInsert>[];

const EVENT_ROW_HANDLERS: Record<string, EventRowsHandler> = {
  system: systemRows,
  assistant: assistantRows,
  user: userRows,
  log: logRows,
  result: (ev) => [resultRow(ev)],
  init: (ev) => [initRow(ev)],
  message: geminiMessageRows,
  tool_use: (ev) => [
    toolCallRow({ name: ev.tool_name, id: ev.tool_id, input: ev.parameters }),
  ],
  tool_result: geminiToolResultRows,
  error: geminiErrorRows,
};

export function rowsFromEnvelope(envelope: unknown): AgentRunEventInsert[] {
  const { source, event } = unwrapAttribution(envelope);
  const taskId = str(source?.task);

  // task_id NOT NULL (migration 0031): must attribute every line to a task.
  if (!taskId) {
    return [];
  }
  const agentCrName = str(source?.agent);

  const carried = parseCarriedRunIdentity(source);

  return rowsFromEvent(event).map((row) => ({
    ...row,
    taskId,
    agentCrName,
    carried,
    eventType: row.eventType as AgentRunEventType,
  }));
}

/** Stream-json line to rows (before task attribution); unknown kinds dropped (forward-compat contract). */
function rowsFromEvent(ev: unknown): Partial<AgentRunEventInsert>[] {
  if (!isRecord(ev)) {
    return [];
  }
  const handler =
    typeof ev.type === "string" ? EVENT_ROW_HANDLERS[ev.type] : undefined;

  return handler ? handler(ev) : [];
}

/** Upper bound on run-visualization rows (pathological runs OOM replica): enforced by parseAgentSink line scanner. */
export const MAX_RUN_EVENTS_PER_BATCH = 10_000;
