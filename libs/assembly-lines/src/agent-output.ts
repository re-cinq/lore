// An agent's output as Lore's stations read it: the text of its terminal result line, and the log line a station prints.

import { isAttributedLine } from "@re-cinq/lore-shared/agent-stream/unwrap-attribution.js";

interface ResultLine {
  type: string;
  result?: unknown;
  is_error?: unknown;
}

// Gemini-style assistant chunk: the CLI streams delta fragments, and the terminal result line carries stats only — no text.
interface MessageLine {
  type: string;
  role?: unknown;
  content?: unknown;
}

// Agent text from the last terminal result line of an NDJSON stream; falls back to raw input when not a stream, no result line, or no string payload — legacy/already-unwrapped output passes through untouched.
export function resultTextFromOutput(output: string): string {
  const lines = output.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseLine(lines[i].trim());

    if (parsed && typeof parsed.result === "string") {
      return parsed.result;
    }

    // A result line with no text payload is the gemini shape (stats-only terminal line, text arrives as preceding delta chunks) — reassemble those or the fallback hands parsers raw escaped NDJSON (run 6cb4b352, 2026-09-02: verdict seen, findings lost).
    if (parsed) {
      return trailingAssistantText(lines, i) ?? output;
    }
  }

  return output;
}

function parseLine(line: string): ResultLine | null {
  try {
    const value: unknown = JSON.parse(line);

    if (isResultLine(value)) {
      return value;
    }

    if (isAttributedLine(value) && isResultLine(value.event)) {
      return value.event;
    }

    return null;
  } catch {
    return null;
  }
}

function isResultLine(value: unknown): value is ResultLine {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ResultLine).type === "result"
  );
}

// Final assistant message, reassembled from delta chunks immediately preceding the result line; stops at the first non-chunk line so a marker mentioned mid-run can't shadow the block actually written, and chunks concatenate with no separator (fragments of one text).
function trailingAssistantText(
  lines: readonly string[],
  resultIndex: number,
): string | null {
  const chunks: string[] = [];

  for (let i = resultIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();

    if (trimmed.length === 0) {
      continue;
    }
    const content = parseAssistantLine(trimmed);

    if (content === null) {
      break;
    }
    chunks.unshift(content);
  }

  return chunks.length > 0 ? chunks.join("") : null;
}

function parseAssistantLine(line: string): string | null {
  try {
    let value: unknown = JSON.parse(line);

    if (isAttributedLine(value)) {
      value = value.event;
    }

    if (!isAssistantChunk(value)) {
      return null;
    }

    return typeof value.content === "string" ? value.content : null;
  } catch {
    return null;
  }
}

function isAssistantChunk(value: unknown): value is MessageLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value as MessageLine;

  return msg.type === "message" && msg.role === "assistant";
}

// Progress lines for the log sinks (anything non-terminal).
export function eventLine(message: string): string {
  return JSON.stringify({ type: "log", message });
}
