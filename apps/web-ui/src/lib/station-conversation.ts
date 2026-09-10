// Renders Station log (runner markers + stream-json) into human-readable transcript.

import { clip, toolSummary, toolResultText } from "./agent-log-entries";

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string }
  | { type: "tool_use"; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; content?: unknown };

interface StreamEvent {
  type?: string;
  message?: { content?: ContentBlock[] };
}

export function formatStationConversation(
  rawLog: string,
  maxEvents = 30,
): string {
  const out = rawLog
    .split("\n")
    .map((line) => line.trim())
    .filter((trimmed) => trimmed.length > 0)
    .map(renderLine)
    .filter((rendered): rendered is string => rendered !== null);

  return out.slice(-maxEvents).join("\n");
}

const MARKER_RE = /^\[(runner|runner-cli|supervisor|agent)\b/;

function renderLine(trimmed: string): string | null {
  if (trimmed.startsWith("{")) {
    return renderJsonLine(trimmed);
  }

  return MARKER_RE.test(trimmed) ? trimmed : null;
}

function renderJsonLine(trimmed: string): string | null {
  try {
    return renderEvent(JSON.parse(trimmed) as StreamEvent);
  } catch {
    return null;
  }
}

function renderEvent(event: StreamEvent): string | null {
  const content = event.message?.content;

  if (!Array.isArray(content)) {
    return null;
  }

  if (event.type === "assistant") {
    return renderAssistantEvent(content);
  }

  if (event.type === "user") {
    return renderUserEvent(content);
  }

  return null; // system / result / thinking_tokens events are noise
}

function renderAssistantEvent(content: ContentBlock[]): string | null {
  const parts = assistantParts(content);

  return parts.length ? parts.join("\n") : null;
}

function renderUserEvent(content: ContentBlock[]): string | null {
  const results = content
    .filter(
      (b): b is Extract<ContentBlock, { type: "tool_result" }> =>
        b.type === "tool_result",
    )
    .map((b) => `← ${clip(toolResultText(b.content), 120)}`);

  return results.length ? results.join("\n") : null;
}

function assistantParts(content: ContentBlock[]): string[] {
  return content
    .map(renderContentPart)
    .filter((part): part is string => part !== null);
}

function renderContentPart<K extends ContentBlock["type"]>(
  block: Extract<ContentBlock, { type: K }>,
): string | null {
  const render = RENDER_BY_TYPE[block.type];

  return render ? render(block) : null;
}

const RENDER_BY_TYPE: {
  [K in ContentBlock["type"]]?: (
    block: Extract<ContentBlock, { type: K }>,
  ) => string | null;
} = {
  text: renderText,
  thinking: renderThinking,
  tool_use: toolSummary,
};

function renderText(
  block: Extract<ContentBlock, { type: "text" }>,
): string | null {
  return block.text?.trim() ? clip(block.text, 300) : null;
}

function renderThinking(
  block: Extract<ContentBlock, { type: "thinking" }>,
): string | null {
  return block.thinking?.trim()
    ? `thinking: ${clip(block.thinking, 240)}`
    : null;
}
