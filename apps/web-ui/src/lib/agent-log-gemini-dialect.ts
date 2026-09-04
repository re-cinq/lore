import type { LogEntry } from "./agent-log-types";
import { errorMessage, isRecord, toolSummary } from "./agent-log-format";

/** A delta chunk keeps whitespace-only content — trimming it would glue the words around it at fold time. */
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

/** gemini-cli's flat dialect: one event per thing, instead of message.content blocks. */
export function geminiStreamEntries(
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
