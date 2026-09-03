// Run-visualization of Agent NDJSON (#876): NOT gated on ev.usage; correlation in PgAgentRunEvents.insertBatch; truncated payloads, full in agent_run_turns.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import { parseCarriedRunIdentity } from "@re-cinq/lore-shared/project/run-identity/carried-run-identity.js";
import type {
  AgentRunEventInsert,
  AgentRunEventType,
} from "@re-cinq/lore-shared";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";

const SUMMARY_MAX_CHARS = 200;
const TOOL_RESULT_MAX_BYTES = 2048;
const TOOL_INPUT_VALUE_MAX_BYTES = 1024;
const TOOL_INPUT_TOTAL_MAX_BYTES = 4096;
const BASH_COMMAND_SUMMARY_CHARS = 120;

/** Tool input keys naming files (exclude bash commands: too noisy). */
const FILE_PATH_KEYS = ["file_path", "path", "notebook_path"] as const;

const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const cap = (text: string): string => text.slice(0, SUMMARY_MAX_CHARS);

/** Byte-cap text with marker showing original size (not chars; prevents false completeness). */
export function truncateForStorage(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return text;
  }

  return `${bytes.subarray(0, maxBytes).toString("utf8")}…[truncated, ${bytes.byteLength} bytes]`;
}

/** File paths named by a tool call's input, in key order, deduplicated. */
export function filePathsFromToolInput(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }
  const paths = FILE_PATH_KEYS.map((key) => str(input[key])).filter(
    (path): path is string => path !== null,
  );

  return [...new Set(paths)];
}

/** Per-value and whole-input byte caps; dropped keys' count recorded. */
function truncateToolInput(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return {};
  }
  const kept: Record<string, unknown> = {};
  const entries = Object.entries(input);
  let used = 0;

  for (const [index, [key, value]] of entries.entries()) {
    // Values arrive from JSON.parse, so JSON.stringify always returns a string.
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    const trimmed = truncateForStorage(encoded, TOOL_INPUT_VALUE_MAX_BYTES);
    const size = Buffer.byteLength(trimmed, "utf8");

    if (used + size > TOOL_INPUT_TOTAL_MAX_BYTES) {
      kept.__truncated__ = `${entries.length - index} input keys omitted`;
      break;
    }
    // Store trimmed value as string once truncated; accounting matches written size.
    kept[key] =
      typeof value === "string" || trimmed !== encoded ? trimmed : value;
    used += size;
  }

  return kept;
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

function toolCallSummary(
  name: string,
  input: unknown,
  filePaths: readonly string[],
): string {
  if (filePaths.length > 0) {
    return cap(`${name} ${filePaths[0]}`);
  }
  const command = isRecord(input) ? str(input.command) : null;

  return command
    ? cap(`${name} ${command.slice(0, BASH_COMMAND_SUMMARY_CHARS)}`)
    : cap(name);
}

function assistantBlockRow(
  block: unknown,
): Partial<AgentRunEventInsert> | null {
  if (!isRecord(block)) {
    return null;
  }

  if (block.type === "text") {
    return {
      eventType: "message",
      summary: cap(str(block.text) ?? ""),
      payload: {},
    };
  }

  if (block.type === "thinking") {
    return {
      eventType: "thinking",
      summary: cap(str(block.thinking) ?? ""),
      payload: {},
    };
  }

  if (block.type !== "tool_use") {
    return null;
  }
  const name = str(block.name) ?? "unknown";
  const filePaths = filePathsFromToolInput(block.input);

  return {
    eventType: "tool_call",
    toolName: name,
    toolUseId: str(block.id),
    filePaths,
    summary: toolCallSummary(name, block.input, filePaths),
    payload: { input: truncateToolInput(block.input) },
  };
}

function toolResultRow(block: unknown): Partial<AgentRunEventInsert> | null {
  if (!isRecord(block) || block.type !== "tool_result") {
    return null;
  }
  const isError = block.is_error === true;

  return {
    eventType: "tool_result",
    toolUseId: str(block.tool_use_id),
    isError,
    summary: `tool_result ${isError ? "error" : "ok"}`,
    payload: {
      content: truncateForStorage(
        toolResultContent(block.content),
        TOOL_RESULT_MAX_BYTES,
      ),
    },
  };
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

function resultRow(ev: Record<string, unknown>): Partial<AgentRunEventInsert> {
  const subtype = str(ev.subtype) ?? "unknown";
  const durationMs = num(ev.duration_ms);
  const costUsd = num(ev.total_cost_usd);

  return {
    eventType: "result",
    isError: ev.is_error === true,
    summary: cap(`result ${subtype} in ${durationMs}ms ($${costUsd})`),
    payload: { subtype, durationMs, costUsd },
  };
}

function systemRows(
  ev: Record<string, unknown>,
): Partial<AgentRunEventInsert>[] {
  if (ev.subtype === "init") {
    return [initRow(ev)];
  }
  const hook = hookRow(ev);

  return hook === null ? [] : [hook];
}

function contentBlocks(ev: Record<string, unknown>): unknown[] {
  const content = isRecord(ev.message) ? ev.message.content : undefined;

  return Array.isArray(content) ? content : [];
}

/** Stream-json line to rows (before task attribution); unknown kinds dropped (forward-compat contract). */
function rowsFromEvent(ev: unknown): Partial<AgentRunEventInsert>[] {
  if (!isRecord(ev)) {
    return [];
  }

  if (ev.type === "system") {
    return systemRows(ev);
  }

  if (ev.type === "assistant") {
    return contentBlocks(ev)
      .map(assistantBlockRow)
      .filter((row): row is Partial<AgentRunEventInsert> => row !== null);
  }

  if (ev.type === "user") {
    return contentBlocks(ev)
      .map(toolResultRow)
      .filter((row): row is Partial<AgentRunEventInsert> => row !== null);
  }

  // Station progress lines (agent-output.ts): no claude stream, so progress fills transcript; "message" event type.
  if (ev.type === "log") {
    const message = str(ev.message);

    return message
      ? [{ eventType: "message", summary: cap(message), payload: {} }]
      : [];
  }

  return ev.type === "result" ? [resultRow(ev)] : [];
}

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

/** Upper bound on run-visualization rows (pathological runs OOM replica): enforced by parseAgentSink line scanner. */
export const MAX_RUN_EVENTS_PER_BATCH = 10_000;
