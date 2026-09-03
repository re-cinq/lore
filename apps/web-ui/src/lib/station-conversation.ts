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

function assistantParts(content: ContentBlock[]): string[] {
  const parts: string[] = [];

  for (const block of content) {
    if (block.type === "text" && block.text?.trim()) {
      parts.push(clip(block.text, 300));
      continue;
    }

    if (block.type === "thinking" && block.thinking?.trim()) {
      parts.push(`thinking: ${clip(block.thinking, 240)}`);
      continue;
    }

    if (block.type === "tool_use") {
      parts.push(toolSummary(block));
    }
  }

  return parts;
}

function renderEvent(event: StreamEvent): string | null {
  const content = event.message?.content;

  if (!Array.isArray(content)) {
    return null;
  }

  if (event.type === "assistant") {
    const parts = assistantParts(content);

    return parts.length ? parts.join("\n") : null;
  }

  if (event.type === "user") {
    const results = content
      .filter(
        (b): b is Extract<ContentBlock, { type: "tool_result" }> =>
          b.type === "tool_result",
      )
      .map((b) => `← ${clip(toolResultText(b.content), 120)}`);

    return results.length ? results.join("\n") : null;
  }

  return null; // system / result / thinking_tokens events are noise
}

const MARKER_RE = /^\[(runner|runner-cli|supervisor|agent)\b/;

function renderJsonLine(trimmed: string): string | null {
  try {
    return renderEvent(JSON.parse(trimmed) as StreamEvent);
  } catch {
    return null;
  }
}

export function formatStationConversation(
  rawLog: string,
  maxEvents = 30,
): string {
  const out: string[] = [];

  for (const line of rawLog.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const rendered = trimmed.startsWith("{") ? renderJsonLine(trimmed) : null;

    if (rendered) {
      out.push(rendered);
    }

    if (trimmed.startsWith("{")) {
      continue;
    }

    if (MARKER_RE.test(trimmed)) {
      out.push(trimmed);
    }
  }

  return out.slice(-maxEvents).join("\n");
}
