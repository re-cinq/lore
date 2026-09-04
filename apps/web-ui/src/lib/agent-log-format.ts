// Generic JSON/text helpers shared by the claude + gemini log dialects.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The message inside a gemini `error: {type, message}` object, or empty. */
export function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : "";
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
