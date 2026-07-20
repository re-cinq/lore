// The run-visualization projection of the Agent NDJSON sink (#876), sitting next
// to the cost mapper (agent-events.ts) and running over the same body. The cost
// mapper keeps one row per run; this one keeps the per-tool-call stream the Floor
// used to discard, as pipeline.agent_run_events rows.
//
// Deliberately NOT gated on `ev.usage`. That gate is correct for cost — a line
// with no LLM usage has no cost — and wrong here: a station's terminal line is
// `{"type":"result","is_error":false,"result":"LORE_NODE_RESULT: {...}"}` with no
// usage at all, and stations already POST their full NDJSON to this sink
// (buildStationDefinition sets the same OUTPUT_SINKS the LLM recipes use). Not
// gating is what makes station nodes — otherwise a blind spot, since their pod
// logs vanish at GC — visible for free.
//
// Correlation is NOT done here. PgAgentRunEvents.insertBatch resolves
// assemblyLineId / nodeId / iteration from agentCrName in the same statement, and
// AgentRunEventInsert has no correlation fields to fill.
//
// The row is a projection, not an archive: payloads are truncated to bound JSONB
// growth, and full fidelity stays the GCS NDJSON archive's job.

import { unwrapAttribution } from "@re-cinq/lore-assembly-lines";
import type {
  AgentRunEventInsert,
  AgentRunEventType,
} from "@re-cinq/lore-shared";

const SUMMARY_MAX_CHARS = 200;
const TOOL_RESULT_MAX_BYTES = 2048;
const TOOL_INPUT_VALUE_MAX_BYTES = 1024;
const TOOL_INPUT_TOTAL_MAX_BYTES = 4096;
const BASH_COMMAND_SUMMARY_CHARS = 120;

/** Tool input keys that name a file. Bash `command` strings are deliberately not
 *  mined for paths — too noisy to be worth the false positives. */
const FILE_PATH_KEYS = ["file_path", "path", "notebook_path"] as const;

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

const num = (x: unknown): number => (typeof x === "number" ? x : 0);

const cap = (text: string): string => text.slice(0, SUMMARY_MAX_CHARS);

/**
 * Byte-cap `text`, appending a visible marker carrying the original size.
 * Bytes, not characters: the cap exists to bound JSONB storage, and the marker
 * is what keeps a truncation from reading as a short-but-complete value.
 */
export function truncateForStorage(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");

  if (bytes.byteLength <= maxBytes) {
    return text;
  }

  return `${bytes.subarray(0, maxBytes).toString("utf8")}…[truncated, ${bytes.byteLength} bytes]`;
}

/** File paths named by a tool call's input, in key order, deduplicated. */
export function filePathsFromToolInput(input: unknown): string[] {
  if (!isObject(input)) {
    return [];
  }
  const paths = FILE_PATH_KEYS.map((key) => str(input[key])).filter(
    (path): path is string => path !== null,
  );

  return [...new Set(paths)];
}

/** Per-value and whole-input byte caps. Keys past the total budget are dropped
 *  and their count recorded, so the loss is visible in the stored payload. */
function truncateToolInput(input: unknown): Record<string, unknown> {
  if (!isObject(input)) {
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
    // A structured value keeps its shape only while it fits; once trimmed, the
    // trimmed STRING is what gets stored. Storing `value` here regardless would
    // leave every object and array input — the largest ones — entirely
    // unbounded, and `used` accounting for a size that was never written.
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
      .map((block) => (isObject(block) ? (str(block.text) ?? "") : ""))
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
  const command = isObject(input) ? str(input.command) : null;

  return command
    ? cap(`${name} ${command.slice(0, BASH_COMMAND_SUMMARY_CHARS)}`)
    : cap(name);
}

function assistantBlockRow(
  block: unknown,
): Partial<AgentRunEventInsert> | null {
  if (!isObject(block)) {
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
  if (!isObject(block) || block.type !== "tool_result") {
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

function contentBlocks(ev: Record<string, unknown>): unknown[] {
  const content = isObject(ev.message) ? ev.message.content : undefined;

  return Array.isArray(content) ? content : [];
}

/** The rows one stream-json line projects to, before task attribution. Any line
 *  kind not listed here is dropped silently — that is the forward-compat
 *  contract: a newer subsystem emitting a kind this Floor has never seen must
 *  not break ingestion. */
function rowsFromEvent(ev: unknown): Partial<AgentRunEventInsert>[] {
  if (!isObject(ev)) {
    return [];
  }

  if (ev.type === "system") {
    return ev.subtype === "init" ? [initRow(ev)] : [];
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

  return ev.type === "result" ? [resultRow(ev)] : [];
}

function rowsFromEnvelope(envelope: unknown): AgentRunEventInsert[] {
  const { source, event } = unwrapAttribution(envelope);
  const taskId = str(source?.task);

  // task_id is NOT NULL in migration 0031, so a line the subsystem did not
  // attribute to a task cannot be persisted at all.
  if (!taskId) {
    return [];
  }
  const agentCrName = str(source?.agent);

  return rowsFromEvent(event).map((row) => ({
    ...row,
    taskId,
    agentCrName,
    eventType: row.eventType as AgentRunEventType,
  }));
}

/** Project the Agent NDJSON sink body into agent_run_events rows. Mirrors
 *  parseAgentEvents' tolerance: blank, unparseable and task-less lines are
 *  skipped and nothing throws — one malformed line must never drop a batch. */
export function parseAgentRunEvents(ndjson: string): AgentRunEventInsert[] {
  const rows: AgentRunEventInsert[] = [];

  for (const line of ndjson.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      rows.push(...rowsFromEnvelope(JSON.parse(line)));
    } catch {
      continue;
    }
  }

  return rows;
}
