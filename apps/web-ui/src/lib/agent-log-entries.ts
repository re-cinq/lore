// Parses an agent pod's raw NDJSON log (claude stream-json events, lifecycle
// markers, station lines, runner markers) into typed entries for the log
// viewers. Lines that cannot be parsed as JSON pass through as raw. Pure.

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
  | { kind: "assistant-text"; text: string }
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
  | {
      kind: "hook";
      hookId: string;
      hookName: string;
      /** The subtype past its `hook_` prefix: started | progress | response,
       *  or whatever a newer subsystem names next. */
      phase: string;
      output: string;
      outcome?: string;
      exitCode?: number;
    }
  | { kind: "system"; subtype: string; detailsJson: string }
  | { kind: "rate-limit"; status: string; windows: RateLimitWindow[] }
  | { kind: "raw"; text: string };

/** One usage window of a rate_limit_event. `utilization` is the fraction the
 *  API sends (0.94 = 94%), `resetsAt` epoch seconds. */
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
      .map((item) => {
        if (!isRecord(item)) {
          return "";
        }

        if (typeof item.text === "string") {
          return item.text;
        }

        if (typeof item.tool_name === "string") {
          return `[${item.tool_name}]`;
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

/**
 * Whether `next` replaces `previous` instead of following it. Two tickers report
 * a running total rather than an increment, so a run of either is one entry:
 * thinking-tokens, and a hook's own line — `hook_progress` repeats the whole
 * output so far, so the newest line for a `hook_id` contains every earlier one.
 * The one home for that rule — the blob parser and the run page's per-turn
 * projection both fold on it rather than each knowing it.
 *
 * Adjacent-only, so two hooks running concurrently keep their interleaved order
 * instead of collapsing across each other's lines.
 */
export function supersedesPrevious(
  previous: LogEntry | undefined,
  next: LogEntry,
): boolean {
  if (next.kind === "thinking-tokens") {
    return previous?.kind === "thinking-tokens";
  }

  return (
    next.kind === "hook" &&
    previous?.kind === "hook" &&
    previous.hookId === next.hookId
  );
}

/** Classifies an already-decoded envelope. Callers holding the object (the
 *  transcript store hands out parsed JSONB) must not stringify to re-parse it. */
export function logEntriesFromValue(
  value: unknown,
  originalLine: string,
): LogEntry[] {
  return classify(unwrapEnvelope(value), originalLine);
}

/** One NDJSON line → its entries. Empty lines yield none; anything that is not
 *  parseable JSON passes through verbatim as raw. */
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
    for (const entry of parseAgentLogLine(line)) {
      if (supersedesPrevious(entries[entries.length - 1], entry)) {
        entries[entries.length - 1] = entry;
        continue;
      }
      entries.push(entry);
    }
  }

  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The ai-agent-subsystem's {"source":…,"event":…} attribution envelope
// (ADR-031 D8); prod streams have carried it single- and double-wrapped.
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

  // Any remaining system line still says which kind it is, which beats dumping
  // its bytes at the reader — the whole event stays one click away.
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

  if (value.type === "result") {
    return [
      {
        kind: "result",
        text: typeof value.result === "string" ? value.result : "",
        isError: value.is_error === true,
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

  if (value.type === "log" && typeof value.message === "string") {
    return [{ kind: "station-log", text: value.message }];
  }

  if (value.type === "rate_limit_event") {
    const info = isRecord(value.rate_limit_info) ? value.rate_limit_info : {};
    const windows = rateLimitWindows(info);

    // A shape carrying no readable window keeps its bytes rather than
    // rendering a confidently empty sentence.
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

const HOOK_SUBTYPE_PREFIX = "hook_";

/** A system line one hook emitted about itself. Keyed on `hook_id` rather than
 *  the three known subtypes, so a newer `hook_*` kind still folds and renders. */
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

/** A hook line's text: the combined `output` when the runner supplies one, else
 *  whatever the two streams carry. */
function hookOutput(value: Record<string, unknown>): string {
  if (typeof value.output === "string" && value.output.trim()) {
    return value.output.trim();
  }

  return [value.stdout, value.stderr]
    .filter((part): part is string => typeof part === "string")
    .join("")
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

    if (block.type === "thinking" && typeof block.thinking === "string") {
      if (block.thinking.trim()) {
        entries.push({ kind: "thinking", text: block.thinking });
      }
    } else if (block.type === "text" && typeof block.text === "string") {
      if (block.text.trim()) {
        entries.push(
          value.type === "user"
            ? { kind: "user-text", text: block.text }
            : { kind: "assistant-text", text: block.text },
        );
      }
    } else if (block.type === "tool_use") {
      entries.push({
        kind: "tool-use",
        summary: toolSummary(
          block as { name?: string; input?: Record<string, unknown> },
        ),
      });
    } else if (block.type === "tool_result") {
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

/** Every window the event reports: the `unifiedWindows` map when present, else
 *  the single window the top-level fields describe. */
export function rateLimitWindows(
  info: Record<string, unknown>,
): RateLimitWindow[] {
  const unified = info.unifiedWindows;

  if (isRecord(unified)) {
    return Object.entries(unified)
      .map(([name, value]) => toWindow(name, value))
      .filter((window): window is RateLimitWindow => window !== null);
  }

  const single =
    typeof info.rateLimitType === "string"
      ? toWindow(info.rateLimitType, info)
      : null;

  return single === null ? [] : [single];
}

/** The whole sentence, formatted here rather than in JSX so it is testable
 *  without a DOM. `utilization` is a fraction of the window, never a percent. */
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
