// Row builders every stream-json dialect shares: a tool call, its result, and the summary caps.

import type { AgentRunEventInsert } from "@re-cinq/lore-shared";
import { isRecord } from "@re-cinq/lore-shared/lib/is-record.js";
import { truncateForStorage } from "../../lib/truncate-for-storage.js";

const SUMMARY_MAX_CHARS = 200;
const TOOL_RESULT_MAX_BYTES = 2048;
const TOOL_INPUT_VALUE_MAX_BYTES = 1024;
const TOOL_INPUT_TOTAL_MAX_BYTES = 4096;
const BASH_COMMAND_SUMMARY_CHARS = 120;

/** Tool input keys naming files (exclude bash commands: too noisy). */
const FILE_PATH_KEYS = ["file_path", "path", "notebook_path"] as const;

export const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const num = (value: unknown): number =>
  typeof value === "number" ? value : 0;

export const cap = (text: string): string => text.slice(0, SUMMARY_MAX_CHARS);

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

interface ToolCall {
  name: unknown;
  id: unknown;
  input: unknown;
}

export function toolCallRow({
  name,
  id,
  input,
}: ToolCall): Partial<AgentRunEventInsert> {
  const toolName = str(name) ?? "unknown";
  const filePaths = filePathsFromToolInput(input);

  return {
    eventType: "tool_call",
    toolName,
    toolUseId: str(id),
    filePaths,
    summary: toolCallSummary(toolName, input, filePaths),
    payload: { input: truncateToolInput(input) },
  };
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

/** Per-value and whole-input byte caps; dropped keys' count recorded. */
function truncateToolInput(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return {};
  }
  const kept: Record<string, unknown> = {};
  const entries = Object.entries(input);
  let used = 0;

  for (const [index, [key, value]] of entries.entries()) {
    const { stored, byteSize } = truncatedInputValue(value);

    if (used + byteSize > TOOL_INPUT_TOTAL_MAX_BYTES) {
      kept.__truncated__ = `${entries.length - index} input keys omitted`;
      break;
    }
    kept[key] = stored;
    used += byteSize;
  }

  return kept;
}

interface TruncatedInputValue {
  stored: unknown;
  byteSize: number;
}

// Values arrive from JSON.parse, so JSON.stringify always returns a string; stored as a string once truncated so accounting matches the written size.
function truncatedInputValue(value: unknown): TruncatedInputValue {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  const trimmed = truncateForStorage(encoded, TOOL_INPUT_VALUE_MAX_BYTES);
  const stored =
    typeof value === "string" || trimmed !== encoded ? trimmed : value;

  return { stored, byteSize: Buffer.byteLength(trimmed, "utf8") };
}

interface ToolResult {
  id: unknown;
  isError: boolean;
  content: string;
}

export function toolResultRowOf({
  id,
  isError,
  content,
}: ToolResult): Partial<AgentRunEventInsert> {
  return {
    eventType: "tool_result",
    toolUseId: str(id),
    isError,
    summary: `tool_result ${isError ? "error" : "ok"}`,
    payload: { content: truncateForStorage(content, TOOL_RESULT_MAX_BYTES) },
  };
}
