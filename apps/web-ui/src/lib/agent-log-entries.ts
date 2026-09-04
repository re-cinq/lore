// Parses an agent pod's raw NDJSON log into typed entries for the log viewers; unparseable lines pass through as raw. Pure.
import type { LogEntry } from "./agent-log-types";
import { isRecord } from "./agent-log-format";
import { mergedDelta, supersedesPrevious } from "./agent-log-merge";
import { claudeStreamEntries } from "./agent-log-claude-dialect";
import { geminiStreamEntries } from "./agent-log-gemini-dialect";
import { stationEntries } from "./agent-log-station";

export type { LogEntry, RateLimitWindow } from "./agent-log-types";
export {
  clip,
  toolSummary,
  toolResultText,
  formatTokens,
  formatDuration,
} from "./agent-log-format";
export { supersedesPrevious, mergedDelta } from "./agent-log-merge";
export { rateLimitWindows, rateLimitSummary } from "./agent-log-station";

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
