import type { LogEntry } from "./agent-log-types";
import { isRecord, toolResultText, toolSummary } from "./agent-log-format";

export function claudeStreamEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] | null {
  // Order is load-bearing: hook before catch-all.
  return (
    sessionEntries(value) ??
    hookOrProgressEntries(value) ??
    namedSystemEntries(value) ??
    claudeMessageEntries(value, originalLine)
  );
}

/** The session header and the thinking-token meter — the two `system` subtypes with a shape of their own. */
function sessionEntries(value: Record<string, unknown>): LogEntry[] | null {
  if (value.type !== "system") {
    return null;
  }

  if (value.subtype === "init") {
    return sessionInitEntry(value);
  }

  return thinkingTokensEntry(value);
}

function hookOrProgressEntries(
  value: Record<string, unknown>,
): LogEntry[] | null {
  if (isHookLine(value)) {
    return [hookEntry(value, value.subtype, value.hook_id)];
  }

  return isToolProgressLine(value) ? [toolProgressEntry(value)] : null;
}

/** Any other `system` line: naming the subtype beats dumping raw bytes at the reader, and the whole event stays one click away. */
function namedSystemEntries(value: Record<string, unknown>): LogEntry[] | null {
  return value.type === "system" && typeof value.subtype === "string"
    ? [
        {
          kind: "system",
          subtype: value.subtype,
          detailsJson: JSON.stringify(value, null, 2),
        },
      ]
    : null;
}

/** An assistant or user turn, whose content blocks carry the text and tool calls. */
function claudeMessageEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] | null {
  if (value.type !== "assistant" && value.type !== "user") {
    return null;
  }
  const entries = messageEntries(value);

  return entries.length > 0 ? entries : silentOrRaw(value, originalLine);
}

function sessionInitEntry(value: Record<string, unknown>): LogEntry[] {
  return [
    {
      kind: "session-init",
      model: typeof value.model === "string" ? value.model : "unknown model",
      ...(typeof value.claude_code_version === "string"
        ? { version: value.claude_code_version }
        : {}),
      detailsJson: JSON.stringify(value, null, 2),
    },
  ];
}

function thinkingTokensEntry(
  value: Record<string, unknown>,
): LogEntry[] | null {
  return value.subtype === "thinking_tokens" &&
    typeof value.estimated_tokens === "number"
    ? [{ kind: "thinking-tokens", tokens: value.estimated_tokens }]
    : null;
}

const HOOK_SUBTYPE_PREFIX = "hook_";

/** Keyed on `hook_id` rather than the three known subtypes, so a newer `hook_*` kind still folds and renders. */
function isHookLine(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { subtype: string; hook_id: string } {
  return (
    value.type === "system" &&
    typeof value.hook_id === "string" &&
    typeof value.subtype === "string" &&
    value.subtype.startsWith(HOOK_SUBTYPE_PREFIX)
  );
}

function hookEntry(
  value: Record<string, unknown>,
  subtype: string,
  hookId: string,
): LogEntry {
  return {
    kind: "hook",
    hookId,
    hookName: typeof value.hook_name === "string" ? value.hook_name : "hook",
    phase: subtype.slice(HOOK_SUBTYPE_PREFIX.length),
    output: hookOutput(value),
    ...(typeof value.outcome === "string" ? { outcome: value.outcome } : {}),
    ...(typeof value.exit_code === "number"
      ? { exitCode: value.exit_code }
      : {}),
  };
}

/** Combined `output` when the runner supplies one, else whatever the two streams carry. */
function hookOutput(value: Record<string, unknown>): string {
  if (typeof value.output === "string" && value.output.trim()) {
    return value.output.trim();
  }

  return [value.stdout, value.stderr]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n")
    .trim();
}

/** Keyed on the type rather than `heartbeat`, so real-progress lines (not just keepalives) still render. */
function isToolProgressLine(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { tool_use_id: string } {
  return (
    value.type === "tool_progress" && typeof value.tool_use_id === "string"
  );
}

function toolProgressEntry(
  value: Record<string, unknown> & { tool_use_id: string },
): LogEntry {
  return {
    kind: "tool-progress",
    toolUseId:
      typeof value.parent_tool_use_id === "string"
        ? value.parent_tool_use_id
        : value.tool_use_id,
    toolName: typeof value.tool_name === "string" ? value.tool_name : "tool",
    ...(typeof value.elapsed_time_seconds === "number" &&
    value.elapsed_time_seconds >= 0
      ? { elapsedSeconds: value.elapsed_time_seconds }
      : {}),
  };
}

function messageEntries(value: Record<string, unknown>): LogEntry[] {
  const content = contentBlocks(value);

  if (content === null) {
    return [];
  }

  return content
    .map((block) => blockEntry(block, value.type))
    .filter((entry): entry is LogEntry => entry !== null);
}

/** What a turn shows when no block produced an entry: nothing when every block was a kind we know that simply had nothing to draw — a thinking block redacted to an empty string is the common one — and the raw envelope only when the shape is one we cannot read. Dumping JSON for a turn we understood perfectly well is louder than the turn itself. */
function silentOrRaw(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] {
  const blocks = contentBlocks(value);

  return blocks !== null && everyBlockKnown(blocks)
    ? []
    : [{ kind: "raw", text: originalLine }];
}

function blockEntry(block: unknown, role: unknown): LogEntry | null {
  if (!isRecord(block)) {
    return null;
  }

  const entry = ENTRY_BY_BLOCK_TYPE.get(String(block.type));

  return entry ? entry(block, role) : null;
}

/** The turn's content blocks, or null when the envelope carries none in the shape we know. */
function contentBlocks(value: Record<string, unknown>): unknown[] | null {
  const message = value.message;
  const content = isRecord(message) ? message.content : null;

  return Array.isArray(content) ? content : null;
}

/** Whether every block is one this dialect knows how to read — an empty list is not, since a turn with no blocks tells us nothing about its shape. */
function everyBlockKnown(blocks: readonly unknown[]): boolean {
  return (
    blocks.length > 0 &&
    blocks.every(
      (block) => isRecord(block) && ENTRY_BY_BLOCK_TYPE.has(String(block.type)),
    )
  );
}

// A Map because the key is the agent's own `block.type`: an object literal answers `constructor` off Object.prototype, so an unknown block type would read as a known one and be called.
const ENTRY_BY_BLOCK_TYPE = new Map<
  string,
  (block: Record<string, unknown>, role: unknown) => LogEntry | null
>([
  ["thinking", (block) => thinkingBlockEntry(block)],
  ["text", (block, role) => textBlockEntry(block, role)],
  ["tool_use", (block) => toolUseBlockEntry(block)],
  ["tool_result", (block) => toolResultBlockEntry(block)],
]);

function thinkingBlockEntry(block: Record<string, unknown>): LogEntry | null {
  const text = trimmedBlockText(block.thinking);

  return text ? { kind: "thinking", text } : null;
}

function textBlockEntry(
  block: Record<string, unknown>,
  role: unknown,
): LogEntry | null {
  const text = trimmedBlockText(block.text);

  if (!text) {
    return null;
  }

  return role === "user"
    ? { kind: "user-text", text }
    : { kind: "assistant-text", text };
}

function toolUseBlockEntry(block: Record<string, unknown>): LogEntry {
  return {
    kind: "tool-use",
    summary: toolSummary(
      block as { name?: string; input?: Record<string, unknown> },
    ),
  };
}

function toolResultBlockEntry(block: Record<string, unknown>): LogEntry {
  return {
    kind: "tool-result",
    text: toolResultText(block.content),
    isError: block.is_error === true,
  };
}

/** The candidate unchanged when it is a non-blank string, else empty. */
function trimmedBlockText(candidate: unknown): string {
  return typeof candidate === "string" && candidate.trim() ? candidate : "";
}
