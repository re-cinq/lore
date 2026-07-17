// Parses an agent pod's raw NDJSON log (claude stream-json events, lifecycle
// markers, station lines, runner markers) into typed entries for the log
// viewers. Lines that cannot be parsed as JSON pass through as raw. Pure.

export type LogEntry =
  | { kind: "lifecycle"; status: string; exitCode?: number }
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
  | { kind: "raw"; text: string };

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

export function parseAgentLog(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const push = (entry: LogEntry) => {
    const last = entries[entries.length - 1];

    if (entry.kind === "thinking-tokens" && last?.kind === "thinking-tokens") {
      entries[entries.length - 1] = entry;

      return;
    }
    entries.push(entry);
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (!trimmed.startsWith("{")) {
      push({ kind: "raw", text: trimmed });
      continue;
    }

    let value: unknown;

    try {
      value = JSON.parse(trimmed);
    } catch {
      push({ kind: "raw", text: trimmed });
      continue;
    }

    for (const entry of classify(unwrapEnvelope(value), trimmed)) {
      push(entry);
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
      typeof value.exitCode === "number"
        ? { kind: "lifecycle", status: value.status, exitCode: value.exitCode }
        : { kind: "lifecycle", status: value.status },
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

  return [{ kind: "raw", text: originalLine }];
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
