import type { LogEntry, RateLimitWindow } from "./agent-log-types";
import { isRecord } from "./agent-log-format";

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

function rateLimitEventEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] | null {
  return value.type === "rate_limit_event"
    ? rateLimitEntries(value, originalLine)
    : null;
}

/** Lines the station emits around the agent: declared artifacts, its own log, and the vendor's rate-limit meter. */
export function stationEntries(
  value: Record<string, unknown>,
  originalLine: string,
): LogEntry[] | null {
  return (
    fileEntry(value) ??
    stationLogEntry(value) ??
    rateLimitEventEntries(value, originalLine)
  );
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
