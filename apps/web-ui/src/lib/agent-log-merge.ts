import type { LogEntry } from "./agent-log-types";

function supersedesThinkingTokens(previous: LogEntry | undefined): boolean {
  return previous?.kind === "thinking-tokens";
}

function supersedesToolProgress(
  previous: LogEntry | undefined,
  next: Extract<LogEntry, { kind: "tool-progress" }>,
): boolean {
  return (
    previous?.kind === "tool-progress" && previous.toolUseId === next.toolUseId
  );
}

function supersedesHook(
  previous: LogEntry | undefined,
  next: LogEntry,
): boolean {
  return (
    next.kind === "hook" &&
    previous?.kind === "hook" &&
    previous.hookId === next.hookId
  );
}

/** Whether `next` replaces `previous`: thinking-tokens, hook_progress, and tool heartbeats all report running totals, not increments (adjacent-only, so concurrent hooks/calls stay interleaved). */
export function supersedesPrevious(
  previous: LogEntry | undefined,
  next: LogEntry,
): boolean {
  if (next.kind === "thinking-tokens") {
    return supersedesThinkingTokens(previous);
  }

  if (next.kind === "tool-progress") {
    return supersedesToolProgress(previous, next);
  }

  return supersedesHook(previous, next);
}

/** Joins a gemini streaming chunk onto the prior assistant text (null if `next` starts its own entry) — gemini emits prose only as `delta:true` fragments, never a final message. */
export function mergedDelta(
  previous: LogEntry | undefined,
  next: LogEntry,
): LogEntry | null {
  if (
    next.kind !== "assistant-text" ||
    next.delta !== true ||
    previous?.kind !== "assistant-text"
  ) {
    return null;
  }

  return {
    kind: "assistant-text",
    text: previous.text + next.text,
    delta: true,
  };
}
