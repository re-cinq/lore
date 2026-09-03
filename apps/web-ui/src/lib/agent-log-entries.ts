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

/** Whether `next` replaces `previous`: thinking-tokens, hook_progress, and tool heartbeats all report running totals, not increments (adjacent-only, so concurrent hooks/calls stay interleaved). */
export function supersedesPrevious(
  previous: LogEntry | undefined,
  next: LogEntry,
): boolean {
  if (next.kind === "thinking-tokens") {
    return previous?.kind === "thinking-tokens";
  }

  if (next.kind === "tool-progress") {
    return (
      previous?.kind === "tool-progress" &&
      previous.toolUseId === next.toolUseId
    );
  }

  return (
    next.kind === "hook" &&
    previous?.kind === "hook" &&
    previous.hookId === next.hookId
  );
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

function classify(value: unknown, originalLine: string): LogEntry[] {
  if (!isRecord(value)) {
    return [{ kind: "raw", text: originalLine }];
  }

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

  if (value.type === "system" && value.subtype === "init") {
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

  if (
    value.type === "system" &&
    value.subtype === "thinking_tokens" &&
    typeof value.estimated_tokens === "number"
  ) {
    return [{ kind: "thinking-tokens", tokens: value.estimated_tokens }];
  }

  if (isHookLine(value)) {
    return [hookEntry(value, value.subtype, value.hook_id)];
  }

  if (isToolProgressLine(value)) {
    return [toolProgressEntry(value)];
  }

  // Naming the subtype beats dumping raw bytes at the reader; the whole event stays one click away.
  if (value.type === "system" && typeof value.subtype === "string") {
    return [
      {
        kind: "system",
        subtype: value.subtype,
        detailsJson: JSON.stringify(value, null, 2),
      },
    ];
  }

  if (value.type === "assistant" || value.type === "user") {
    const entries = messageEntries(value);

    return entries.length > 0 ? entries : [{ kind: "raw", text: originalLine }];
  }

  // gemini-cli stream-json dialect: flat events instead of message.content blocks (init/message/tool_use/tool_result/error/result-by-status).
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

  if (value.type === "tool_use" && typeof value.tool_name === "string") {
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

  if (value.type === "tool_result" && typeof value.tool_id === "string") {
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

  if (value.type === "error" && typeof value.message === "string") {
    return [
      {
        kind: "agent-error",
        severity: value.severity === "warning" ? "warning" : "error",
        message: value.message,
      },
    ];
  }

  if (value.type === "result") {
    return [
      {
        kind: "result",
        text:
          typeof value.result === "string"
            ? value.result
            : errorMessage(value.error),
        isError: value.is_error === true || value.status === "error",
        ...(typeof value.duration_ms === "number"
          ? { durationMs: value.duration_ms }
          : {}),
        ...(typeof value.total_cost_usd === "number"
          ? { costUsd: value.total_cost_usd }
          : {}),
        ...(typeof value.num_turns === "number"
          ? { numTurns: value.num_turns }
          : {}),
      },
    ];
  }

  // Declared-artifact delivery — an event name is required, or the floor projection can't route it, so the bytes stay raw.
  if (value.kind === "file" && typeof value.event === "string") {
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

  if (value.type === "log" && typeof value.message === "string") {
    return [{ kind: "station-log", text: value.message }];
  }

  if (value.type === "rate_limit_event") {
    const info = isRecord(value.rate_limit_info) ? value.rate_limit_info : {};
    const windows = rateLimitWindows(info);

    // No readable window keeps its bytes rather than rendering a confidently empty sentence.
    return windows.length > 0
      ? [
          {
            kind: "rate-limit",
            status: typeof info.status === "string" ? info.status : "",
            windows,
          },
        ]
      : [{ kind: "raw", text: originalLine }];
  }

  return [{ kind: "raw", text: originalLine }];
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

function messageEntries(value: Record<string, unknown>): LogEntry[] {
  const message = value.message;

  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }
  const entries: LogEntry[] = [];

  for (const block of message.content) {
    if (!isRecord(block)) {
      continue;
    }

    const thinkingText = trimmedBlockText(block.thinking);
    const blockText = trimmedBlockText(block.text);

    if (block.type === "thinking" && thinkingText === "") {
      continue;
    }

    if (block.type === "thinking") {
      entries.push({ kind: "thinking", text: thinkingText });
      continue;
    }

    if (block.type === "text" && blockText === "") {
      continue;
    }

    if (block.type === "text") {
      entries.push(
        value.type === "user"
          ? { kind: "user-text", text: blockText }
          : { kind: "assistant-text", text: blockText },
      );
      continue;
    }

    if (block.type === "tool_use") {
      entries.push({
        kind: "tool-use",
        summary: toolSummary(
          block as { name?: string; input?: Record<string, unknown> },
        ),
      });
      continue;
    }

    if (block.type === "tool_result") {
      entries.push({
        kind: "tool-result",
        text: toolResultText(block.content),
        isError: block.is_error === true,
      });
    }
  }

  return entries;
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
