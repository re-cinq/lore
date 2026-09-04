// Parses an agent pod's raw NDJSON log into typed entries for the log viewers; unparseable lines pass through as raw. Pure.
export type LogEntry =
  | { kind: "lifecycle"; phase?: string; status: string; exitCode?: number }
  | {
      kind: "session-init";
      model: string;
      version?: string;
      detailsJson: string;
    }
  | { kind: "thinking-tokens"; tokens: number }
  | { kind: "thinking"; text: string }
  | {
      kind: "assistant-text";
      text: string;
      /** Gemini streaming chunk — the fold appends it to the previous assistant-text instead of a new paragraph. */
      delta?: true;
    }
  | { kind: "tool-use"; summary: string }
  | { kind: "tool-result"; text: string; isError: boolean }
  | { kind: "user-text"; text: string }
  | {
      kind: "result";
      text: string;
      isError: boolean;
      durationMs?: number;
      costUsd?: number;
      numTurns?: number;
    }
  | { kind: "station-log"; text: string }
  /** Declared artifact raised after the agent exited (`output.watch` → `{"kind":"file"}`); `reason` present, `content` empty, when never produced. */
  | {
      kind: "file";
      /** The recipe-declared event name, e.g. `pr.description`. */
      event: string;
      path: string;
      content: string;
      reason?: string;
    }
  | {
      kind: "hook";
      hookId: string;
      hookName: string;
      /** The subtype past its `hook_` prefix: started | progress | response, or whatever comes next. */
      phase: string;
      output: string;
      outcome?: string;
      exitCode?: number;
    }
  | {
      kind: "tool-progress";
      /** `parent_tool_use_id` when present — a heartbeat's own `tool_use_id` is a fresh `<parent>-heartbeat-<n>` and would defeat the fold. */
      toolUseId: string;
      toolName: string;
      /** Absent when the line reports no clock — the summary omits the parenthetical rather than claiming zero seconds. */
      elapsedSeconds?: number;
    }
  | { kind: "system"; subtype: string; detailsJson: string }
  | { kind: "rate-limit"; status: string; windows: RateLimitWindow[] }
  /** gemini-cli's standalone error event — claude carries errors inside its result line instead. */
  | { kind: "agent-error"; severity: "warning" | "error"; message: string }
  | { kind: "raw"; text: string };

/** One usage window of a rate_limit_event; `utilization` is a fraction (0.94 = 94%), `resetsAt` epoch seconds. */
export interface RateLimitWindow {
  window: string;
  utilization: number;
  resetsAt: number | null;
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function toolSummary(block: {
  name?: string;
  input?: Record<string, unknown>;
}): string {
  const input = block.input ?? {};
  const arg = [
    input.command,
    input.file_path,
    input.pattern,
    input.path,
    input.description,
  ].find((v): v is string => typeof v === "string" && v.length > 0);

  return arg
    ? `→ ${block.name}: ${clip(arg, 100)}`
    : `→ ${block.name ?? "tool"}`;
}

export function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!isRecord(block)) {
          return "";
        }

        if (typeof block.text === "string") {
          return block.text;
        }

        if (typeof block.tool_name === "string") {
          return `[${block.tool_name}]`;
        }

        return "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }

  return "";
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `~${tokens}`;
  }
  const thousands = Math.round(tokens / 100) / 10;

  return `~${thousands}k`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function supersedesThinkingTokens(previous: LogEntry | undefined): boolean {
  return previous?.kind === "thinking-tokens";
}

function supersedesToolProgress(
  previous: LogEntry | undefined,
  next: Extract<LogEntry, { kind: "tool-progress" }>,
): boolean {
  return (
    previous?.kind === "tool-progress" && previous.toolUseId === next.toolUseId
  );
}

function supersedesHook(
  previous: LogEntry | undefined,
  next: LogEntry,
): boolean {
  return (
    next.kind === "hook" &&
    previous?.kind === "hook" &&
    previous.hookId === next.hookId
  );
}

/** Whether `next` replaces `previous`: thinking-tokens, hook_progress, and tool heartbeats all report running totals, not increments (adjacent-only, so concurrent hooks/calls stay interleaved). */
export function supersedesPrevious(
  previous: LogEntry | undefined,
  next: LogEntry,
): boolean {
  if (next.kind === "thinking-tokens") {
    return supersedesThinkingTokens(previous);
  }

  if (next.kind === "tool-progress") {
    return supersedesToolProgress(previous, next);
  }

  return supersedesHook(previous, next);
}

/** Joins a gemini streaming chunk onto the prior assistant text (null if `next` starts its own entry) — gemini emits prose only as `delta:true` fragments, never a final message. */
export function mergedDelta(
  previous: LogEntry | undefined,
  next: LogEntry,
): LogEntry | null {
  if (
    next.kind !== "assistant-text" ||
    next.delta !== true ||
    previous?.kind !== "assistant-text"
  ) {
    return null;
  }

  return {
    kind: "assistant-text",
    text: previous.text + next.text,
    delta: true,
  };
}

/** Classifies an already-decoded envelope — callers holding the object (transcript store hands out parsed JSONB) must not stringify to re-parse it. */
export function logEntriesFromValue(
  value: unknown,
  originalLine: string,
): LogEntry[] {
  return classify(unwrapEnvelope(value), originalLine);
}

/** One NDJSON line → its entries; empty lines yield none, unparseable JSON passes through verbatim as raw. */
export function parseAgentLogLine(line: string): LogEntry[] {
  const trimmed = line.trim();

  if (!trimmed) {
    return [];
  }

  if (!trimmed.startsWith("{")) {
    return [{ kind: "raw", text: trimmed }];
  }

  let value: unknown;

  try {
    value = JSON.parse(trimmed);
  } catch {
    return [{ kind: "raw", text: trimmed }];
  }

  return logEntriesFromValue(value, trimmed);
}

export function parseAgentLog(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const line of raw.split("\n")) {
    parseAgentLogLine(line).forEach((entry) => {
      const previous = entries[entries.length - 1];
      const merged = mergedDelta(previous, entry);

      if (merged !== null) {
        entries[entries.length - 1] = merged;

        return;
      }

      if (supersedesPrevious(previous, entry)) {
        entries[entries.length - 1] = entry;

        return;
      }
      entries.push(entry);
    });
  }

  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The message inside a gemini `error: {type, message}` object, or empty. */
function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : "";
}

// {"source":…,"event":…} attribution envelope (ADR-031 D8); prod streams carry it single- and double-wrapped.
function isAttributedEnvelope(
  value: unknown,
): value is { source: unknown; event: unknown } {
  return isRecord(value) && "source" in value && "event" in value;
}

function unwrapEnvelope(value: unknown): unknown {
  let current = value;
  let depth = 0;

  while (depth < 3 && isAttributedEnvelope(current)) {
    current = current.event;
    depth += 1;
  }

  return current;
}

/** The stream carries two CLI dialects. Claude Code nests content under `message.content`; gemini-cli emits flat events. A shape belongs to exactly one of them, so each dialect answers for its own and `null` means "not mine". */
function classify(value: unknown, originalLine: string): LogEntry[] {
  if (!isRecord(value)) {
    return [{ kind: "raw", text: originalLine }];
  }

  return (
    lifecycleEntries(value) ??
    claudeStreamEntries(value, originalLine) ??
    geminiStreamEntries(value) ??
    stationEntries(value, originalLine) ?? [{ kind: "raw", text: originalLine }]
  );
}

/** The Floor's own wrapper events, emitted around either dialect. */
function lifecycleEntries(value: Record<string, unknown>): LogEntry[] | null {
  if (value.kind === "lifecycle" && typeof value.status === "string") {
    return [
      {
        kind: "lifecycle",
        status: value.status,
        ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
        ...(typeof value.exitCode === "number"
          ? { exitCode: value.exitCode }
          : {}),
      },
    ];
  }

  return null;
}

function claudeStreamEntries(
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

function hookOrProgressEntries(
  value: Record<string, unknown>,
): LogEntry[] | null {
  if (isHookLine(value)) {
    return [hookEntry(value, value.subtype, value.hook_id)];
  }

  return isToolProgressLine(value) ? [toolProgressEntry(value)] : null;
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

  return entries.length > 0 ? entries : [{ kind: "raw", text: originalLine }];
}

/** gemini-cli's flat dialect: one event per thing, instead of message.content blocks. */
function geminiStreamEntries(
  value: Record<string, unknown>,
): LogEntry[] | null {
  if (value.type === "init" && typeof value.model === "string") {
    return [
      {
        kind: "session-init",
        model: value.model,
        detailsJson: JSON.stringify(value, null, 2),
      },
    ];
  }

  if (value.type === "message" && typeof value.content === "string") {
    return plainMessageEntries(value.role, value.content, value.delta === true);
  }

  return geminiToolEntries(value) ?? geminiOutcomeEntries(value);
}

function geminiToolUseEntry(value: Record<string, unknown>): LogEntry[] | null {
  if (value.type !== "tool_use" || typeof value.tool_name !== "string") {
    return null;
  }

  return [
    {
      kind: "tool-use",
      summary: toolSummary({
        name: value.tool_name,
        ...(isRecord(value.parameters) ? { input: value.parameters } : {}),
      }),
    },
  ];
}

function geminiToolResultEntry(
  value: Record<string, unknown>,
): LogEntry[] | null {
  if (value.type !== "tool_result" || typeof value.tool_id !== "string") {
    return null;
  }

  return [
    {
      kind: "tool-result",
      text:
        typeof value.output === "string"
          ? value.output
          : errorMessage(value.error),
      isError: value.status === "error",
    },
  ];
}

function geminiToolEntries(value: Record<string, unknown>): LogEntry[] | null {
  return geminiToolUseEntry(value) ?? geminiToolResultEntry(value);
}

function geminiErrorEntry(value: Record<string, unknown>): LogEntry[] | null {
  if (value.type !== "error" || typeof value.message !== "string") {
    return null;
  }

  return [
    {
      kind: "agent-error",
      severity: value.severity === "warning" ? "warning" : "error",
      message: value.message,
    },
  ];
}

function durationField(value: unknown): { durationMs?: number } {
  return typeof value === "number" ? { durationMs: value } : {};
}

function costField(value: unknown): { costUsd?: number } {
  return typeof value === "number" ? { costUsd: value } : {};
}

function turnsField(value: unknown): { numTurns?: number } {
  return typeof value === "number" ? { numTurns: value } : {};
}

function geminiResultEntry(value: Record<string, unknown>): LogEntry[] | null {
  if (value.type !== "result") {
    return null;
  }

  return [
    {
      kind: "result",
      text:
        typeof value.result === "string"
          ? value.result
          : errorMessage(value.error),
      isError: value.is_error === true || value.status === "error",
      ...durationField(value.duration_ms),
      ...costField(value.total_cost_usd),
      ...turnsField(value.num_turns),
    },
  ];
}

/** How a gemini run ends: an error mid-flight, or the terminal result line. */
function geminiOutcomeEntries(
  value: Record<string, unknown>,
): LogEntry[] | null {
  return geminiErrorEntry(value) ?? geminiResultEntry(value);
}

// Declared-artifact delivery — an event name is required, or the floor projection can't route it, so the bytes stay raw.
function fileEntry(value: Record<string, unknown>): LogEntry[] | null {
  if (value.kind !== "file" || typeof value.event !== "string") {
    return null;
  }

  return [
    {
      kind: "file",
      event: value.event,
      path: typeof value.path === "string" ? value.path : "",
      content: typeof value.content === "string" ? value.content : "",
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    },
  ];
}

function stationLogEntry(value: Record<string, unknown>): LogEntry[] | null {
  return value.type === "log" && typeof value.message === "string"
    ? [{ kind: "station-log", text: value.message }]
    : null;
}

function rateLimitEventEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] | null {
  return value.type === "rate_limit_event"
    ? rateLimitEntries(value, originalLine)
    : null;
}

/** Lines the station emits around the agent: declared artifacts, its own log, and the vendor's rate-limit meter. */
function stationEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] | null {
  return (
    fileEntry(value) ??
    stationLogEntry(value) ??
    rateLimitEventEntries(value, originalLine)
  );
}

function rateLimitEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] {
  const rateLimit = isRecord(value.rate_limit_info)
    ? value.rate_limit_info
    : {};
  const windows = rateLimitWindows(rateLimit);

  // No readable window keeps its bytes rather than rendering a confidently empty sentence.
  return windows.length > 0
    ? [
        {
          kind: "rate-limit",
          status: typeof rateLimit.status === "string" ? rateLimit.status : "",
          windows,
        },
      ]
    : [{ kind: "raw", text: originalLine }];
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

// A delta chunk keeps whitespace-only content — trimming it would glue the words around it at fold time.
function plainMessageEntries(
  role: unknown,
  content: string,
  delta: boolean,
): LogEntry[] {
  if (delta && role !== "user") {
    return content
      ? [{ kind: "assistant-text", text: content, delta: true }]
      : [];
  }

  if (!content.trim()) {
    return [];
  }

  if (role === "user") {
    return [{ kind: "user-text", text: content }];
  }

  return [{ kind: "assistant-text", text: content }];
}

/** The candidate unchanged when it is a non-blank string, else empty. */
function trimmedBlockText(candidate: unknown): string {
  return typeof candidate === "string" && candidate.trim() ? candidate : "";
}

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

function blockEntry(block: unknown, role: unknown): LogEntry | null {
  if (!isRecord(block)) {
    return null;
  }

  switch (block.type) {
    case "thinking":
      return thinkingBlockEntry(block);
    case "text":
      return textBlockEntry(block, role);
    case "tool_use":
      return toolUseBlockEntry(block);
    case "tool_result":
      return toolResultBlockEntry(block);
    default:
      return null;
  }
}

function messageEntries(value: Record<string, unknown>): LogEntry[] {
  const message = value.message;

  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content
    .map((block) => blockEntry(block, value.type))
    .filter((entry): entry is LogEntry => entry !== null);
}

function toWindow(name: string, value: unknown): RateLimitWindow | null {
  if (!isRecord(value) || typeof value.utilization !== "number") {
    return null;
  }

  return {
    window: name,
    utilization: value.utilization,
    resetsAt: typeof value.resetsAt === "number" ? value.resetsAt : null,
  };
}

/** Every window the event reports: `unifiedWindows` map when present, else the single window the top-level fields describe. */
export function rateLimitWindows(
  rateLimit: Record<string, unknown>,
): RateLimitWindow[] {
  const unified = rateLimit.unifiedWindows;

  if (isRecord(unified)) {
    return Object.entries(unified)
      .map(([name, value]) => toWindow(name, value))
      .filter((window): window is RateLimitWindow => window !== null);
  }

  const single =
    typeof rateLimit.rateLimitType === "string"
      ? toWindow(rateLimit.rateLimitType, rateLimit)
      : null;

  return single === null ? [] : [single];
}

/** Formatted here (not JSX) so it's testable without a DOM; `utilization` is a fraction, never a percent. */
export function rateLimitSummary(
  entry: Extract<LogEntry, { kind: "rate-limit" }>,
): string {
  const windows = entry.windows
    .map((window) => {
      const percent = `${window.window} ${Math.round(window.utilization * 100)}%`;

      return window.resetsAt === null
        ? percent
        : `${percent}, resets ${new Date(
            window.resetsAt * 1000,
          ).toLocaleTimeString()}`;
    })
    .join(" · ");

  return entry.status
    ? `rate limit: ${windows} (${entry.status})`
    : `rate limit: ${windows}`;
}
