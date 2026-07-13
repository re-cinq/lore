// Renders a Station's raw container log — interleaved runner markers and the
// claude CLI's stream-json events — into a compact, human-readable transcript of
// the model's conversation for the planning wizard's live view. Pure.

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string }
  | { type: "tool_use"; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; content?: unknown };

interface StreamEvent {
  type?: string;
  message?: { content?: ContentBlock[] };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function toolSummary(block: {
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

function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((c) => (c as { text?: string }).text ?? "").join(" ");
  }

  return "";
}

function renderEvent(event: StreamEvent): string | null {
  const content = event.message?.content;

  if (!Array.isArray(content)) {
    return null;
  }

  if (event.type === "assistant") {
    const parts: string[] = [];

    for (const block of content) {
      if (block.type === "text" && block.text?.trim()) {
        parts.push(clip(block.text, 300));
      } else if (block.type === "thinking" && block.thinking?.trim()) {
        parts.push(`thinking: ${clip(block.thinking, 240)}`);
      } else if (block.type === "tool_use") {
        parts.push(toolSummary(block));
      }
    }

    return parts.length ? parts.join("\n") : null;
  }

  if (event.type === "user") {
    const results = content
      .filter(
        (b): b is Extract<ContentBlock, { type: "tool_result" }> =>
          b.type === "tool_result",
      )
      .map((b) => `← ${clip(resultText(b.content), 120)}`);

    return results.length ? results.join("\n") : null;
  }

  return null; // system / result / thinking_tokens events are noise
}

const MARKER_RE = /^\[(runner|runner-cli|supervisor|agent)\b/;

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

    if (trimmed.startsWith("{")) {
      let event: StreamEvent;

      try {
        event = JSON.parse(trimmed) as StreamEvent;
      } catch {
        continue;
      }
      const rendered = renderEvent(event);

      if (rendered) {
        out.push(rendered);
      }
    } else if (MARKER_RE.test(trimmed)) {
      out.push(trimmed);
    }
  }

  return out.slice(-maxEvents).join("\n");
}
