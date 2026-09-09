// The typed shape agent-log-entries.ts parses NDJSON log lines into; unparseable lines pass through as raw.
export type LogEntry =
  | { kind: "lifecycle"; phase?: string; status: string; exitCode?: number }
  | {
      kind: "session-init";
      model: string;
      version?: string;
      detailsJson: string;
    }
  | { kind: "thinking-tokens"; tokens: number }
  | { kind: "thinking"; text: string }
  | {
      kind: "assistant-text";
      text: string;
      /** Gemini streaming chunk — the fold appends it to the previous assistant-text instead of a new paragraph. */
      delta?: true;
    }
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
  /** Declared artifact raised after the agent exited (`output.watch` → `{"kind":"file"}`); `reason` present, `content` empty, when never produced. */
  | {
      kind: "file";
      /** The recipe-declared event name, e.g. `pr.description`. */
      event: string;
      path: string;
      content: string;
      reason?: string;
    }
  | {
      kind: "hook";
      hookId: string;
      hookName: string;
      /** The subtype past its `hook_` prefix: started | progress | response, or whatever comes next. */
      phase: string;
      output: string;
      outcome?: string;
      exitCode?: number;
    }
  | {
      kind: "tool-progress";
      /** `parent_tool_use_id` when present — a heartbeat's own `tool_use_id` is a fresh `<parent>-heartbeat-<n>` and would defeat the fold. */
      toolUseId: string;
      toolName: string;
      /** Absent when the line reports no clock — the summary omits the parenthetical rather than claiming zero seconds. */
      elapsedSeconds?: number;
    }
  | { kind: "system"; subtype: string; detailsJson: string }
  | { kind: "rate-limit"; status: string; windows: RateLimitWindow[] }
  /** gemini-cli's standalone error event — claude carries errors inside its result line instead. */
  | { kind: "agent-error"; severity: "warning" | "error"; message: string }
  | { kind: "raw"; text: string };

/** One usage window of a rate_limit_event; `utilization` is a fraction (0.94 = 94%), `resetsAt` epoch seconds. */
export interface RateLimitWindow {
  window: string;
  utilization: number;
  resetsAt: number | null;
}
