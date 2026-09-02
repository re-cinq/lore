import { describe, it, expect } from "vitest";
import {
  parseAgentLog,
  parseAgentLogLine,
  logEntriesFromValue,
  mergedDelta,
  supersedesPrevious,
  rateLimitSummary,
  formatTokens,
  formatDuration,
  clip,
  type LogEntry,
} from "./agent-log-entries";
import {
  LIFECYCLE_STARTED,
  LIFECYCLE_SUCCEEDED,
  SESSION_INIT,
  THINKING_TOKENS_11,
  THINKING_TOKENS_21,
  THINKING_TOKENS_444,
  ASSISTANT_THINKING,
  ASSISTANT_TEXT,
  TOOL_USE_SKILL,
  TOOL_USE_BASH,
  TOOL_RESULT_OK,
  TOOL_RESULT_ERROR,
  TOOL_RESULT_ARRAY,
  USER_PROMPT,
  RESULT_TERMINAL,
  STATION_LOG,
  NODE_RESULT_LINE,
  RUNNER_MARKER,
  wrapped,
  doubleWrapped,
  SAMPLE_LOG,
  LIFECYCLE_INIT_STARTED,
  RATE_LIMIT_EVENT,
  HOOK_STARTED_SESSION,
  HOOK_STARTED_BOOTSTRAP,
  HOOK_RESPONSE_SESSION,
  HOOK_PROGRESS_BOOTSTRAP_FIRST,
  HOOK_PROGRESS_BOOTSTRAP_LAST,
  HOOK_RESPONSE_BOOTSTRAP,
  HOOK_RESPONSE_FAILED,
  TOOL_PROGRESS_SKILL_FIRST,
  TOOL_PROGRESS_SKILL_LAST,
  SYSTEM_COMPACT_BOUNDARY,
  GEMINI_INIT,
  GEMINI_USER_MESSAGE,
  GEMINI_TOOL_USE,
  GEMINI_TOOL_RESULT_OK,
  GEMINI_TOOL_RESULT_ERROR,
  GEMINI_ASSISTANT_DELTA_FIRST,
  GEMINI_ASSISTANT_DELTA_LAST,
  GEMINI_ERROR_EVENT,
  GEMINI_RESULT_SUCCESS,
  GEMINI_RESULT_ERROR,
} from "./agent-log-entries.fixtures";

describe("parseAgentLog", () => {
  it("returns [] for an empty blob and skips blank lines", () => {
    expect(parseAgentLog("")).toEqual([]);
    expect(parseAgentLog("\n  \n\n")).toEqual([]);
  });

  it("keeps a non-JSON runner marker line verbatim as a raw entry", () => {
    expect(parseAgentLog(RUNNER_MARKER)).toEqual([
      { kind: "raw", text: RUNNER_MARKER },
    ]);
  });

  it("keeps an unterminated JSON fragment as a raw entry", () => {
    const fragment = SESSION_INIT.slice(0, 80);

    expect(parseAgentLog(fragment)).toEqual([{ kind: "raw", text: fragment }]);
  });

  it("parses lifecycle started without exitCode and succeeded with exit 0", () => {
    expect(
      parseAgentLog(`${LIFECYCLE_STARTED}\n${LIFECYCLE_SUCCEEDED}`),
    ).toEqual([
      { kind: "lifecycle", phase: "agent", status: "started" },
      { kind: "lifecycle", phase: "agent", status: "succeeded", exitCode: 0 },
    ]);
  });

  it("parses the init line to model claude-sonnet-4-6 and version 2.1.212 with pretty details", () => {
    const [entry] = parseAgentLog(SESSION_INIT);

    expect(entry).toMatchObject({
      kind: "session-init",
      model: "claude-sonnet-4-6",
      version: "2.1.212",
    });
    expect((entry as { detailsJson: string }).detailsJson).toMatch(
      /"permissionMode": "bypassPermissions"/,
    );
  });

  it("coalesces a run of three thinking_tokens lines into one entry with the latest count 444", () => {
    const blob = [
      THINKING_TOKENS_11,
      THINKING_TOKENS_21,
      THINKING_TOKENS_444,
    ].join("\n");

    expect(parseAgentLog(blob)).toEqual([
      { kind: "thinking-tokens", tokens: 444 },
    ]);
  });

  it("starts a new thinking-tokens counter after the run is broken by another entry", () => {
    const blob = [
      THINKING_TOKENS_11,
      THINKING_TOKENS_21,
      ASSISTANT_THINKING,
      THINKING_TOKENS_444,
    ].join("\n");

    expect(parseAgentLog(blob).map((e) => e.kind)).toEqual([
      "thinking-tokens",
      "thinking",
      "thinking-tokens",
    ]);
  });

  it("parses an assistant thinking block into a thinking entry", () => {
    const [entry] = parseAgentLog(ASSISTANT_THINKING);

    expect(entry).toMatchObject({ kind: "thinking" });
    expect((entry as { text: string }).text).toMatch(
      /^Let me review pull request #871/,
    );
  });

  it("parses assistant text 'I'll fetch the PR metadata and diff to conduct a thorough review.'", () => {
    expect(parseAgentLog(ASSISTANT_TEXT)).toEqual([
      {
        kind: "assistant-text",
        text: "I'll fetch the PR metadata and diff to conduct a thorough review.",
      },
    ]);
  });

  it("summarizes a Bash tool_use to '→ Bash: gh pr view 871 …'", () => {
    const [entry] = parseAgentLog(TOOL_USE_BASH);

    expect(entry).toMatchObject({ kind: "tool-use" });
    expect((entry as { summary: string }).summary).toMatch(
      /^→ Bash: gh pr view 871/,
    );
  });

  it("summarizes a tool_use without a recognized text arg as the bare tool name", () => {
    expect(parseAgentLog(TOOL_USE_SKILL)).toEqual([
      { kind: "tool-use", summary: "→ Skill" },
    ]);
  });

  it("parses a string tool_result 'Launching skill: review' as non-error", () => {
    expect(parseAgentLog(TOOL_RESULT_OK)).toEqual([
      { kind: "tool-result", text: "Launching skill: review", isError: false },
    ]);
  });

  it("marks the exit-127 tool_result as error and keeps its newline", () => {
    const [entry] = parseAgentLog(TOOL_RESULT_ERROR);

    expect(entry).toMatchObject({ kind: "tool-result", isError: true });
    expect((entry as { text: string }).text).toEqual(
      "Exit code 127\n/bin/bash: line 1: gh: command not found",
    );
  });

  it("renders array-form tool_result tool references as bracketed tool names", () => {
    expect(parseAgentLog(TOOL_RESULT_ARRAY)).toEqual([
      { kind: "tool-result", text: "[WebFetch]", isError: false },
    ]);
  });

  it("parses the injected user prompt into a user-text entry", () => {
    const [entry] = parseAgentLog(USER_PROMPT);

    expect(entry).toMatchObject({ kind: "user-text" });
    expect((entry as { text: string }).text).toMatch(
      /^Review target: GitHub pull request `871`\./,
    );
  });

  it("parses the terminal result line to duration 201372ms, 27 turns and cost", () => {
    const [entry] = parseAgentLog(RESULT_TERMINAL);

    expect(entry).toMatchObject({
      kind: "result",
      isError: false,
      durationMs: 201372,
      numTurns: 27,
      costUsd: 0.5066994499999999,
    });
    expect((entry as { text: string }).text).toMatch(/REVIEW_RESULT:APPROVED/);
  });

  it("parses a station eventLine into a station-log entry", () => {
    expect(parseAgentLog(STATION_LOG)).toEqual([
      { kind: "station-log", text: "detect: scanning 42 specs" },
    ]);
  });

  it("keeps the LORE_NODE_RESULT text verbatim inside the result entry", () => {
    expect(parseAgentLog(NODE_RESULT_LINE)).toEqual([
      {
        kind: "result",
        text: 'LORE_NODE_RESULT: {"outcome":"success","extras":{}}',
        isError: false,
      },
    ]);
  });

  it("classifies a single-wrapped envelope line the same as the bare line", () => {
    expect(parseAgentLog(wrapped(TOOL_USE_BASH))).toEqual(
      parseAgentLog(TOOL_USE_BASH),
    );
  });

  it("classifies a double-wrapped envelope line the same as the bare line", () => {
    expect(parseAgentLog(doubleWrapped(TOOL_RESULT_ERROR))).toEqual(
      parseAgentLog(TOOL_RESULT_ERROR),
    );
  });

  it("keeps unknown valid JSON as a raw entry with the original line", () => {
    expect(parseAgentLog('{"foo":1}')).toEqual([
      { kind: "raw", text: '{"foo":1}' },
    ]);
  });

  it("emits one entry per content block when a message carries thinking and tool_use together", () => {
    const twoBlocks = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "checking the diff first" },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "gh pr diff 871" },
          },
        ],
      },
    });

    expect(parseAgentLog(twoBlocks)).toEqual([
      { kind: "thinking", text: "checking the diff first" },
      { kind: "tool-use", summary: "→ Bash: gh pr diff 871" },
    ]);
  });

  it("parses the assembled sample log into the expected kind sequence with one counter per run", () => {
    const kinds = parseAgentLog(SAMPLE_LOG).map((e: LogEntry) => e.kind);

    expect(kinds).toEqual([
      "lifecycle",
      "session-init",
      "thinking-tokens",
      "thinking",
      "tool-use",
      "tool-result",
      "user-text",
      "thinking-tokens",
      "assistant-text",
      "tool-use",
      "tool-result",
      "raw",
      "station-log",
      "result",
      "lifecycle",
    ]);
  });
});

describe("formatTokens", () => {
  it("formats 4200 tokens as ~4.2k and 444 as ~444", () => {
    expect(formatTokens(4200)).toEqual("~4.2k");
    expect(formatTokens(444)).toEqual("~444");
    expect(formatTokens(1000)).toEqual("~1k");
  });
});

describe("formatDuration", () => {
  it("formats 201372ms as 3m 21s and 8000ms as 8s", () => {
    expect(formatDuration(201372)).toEqual("3m 21s");
    expect(formatDuration(8000)).toEqual("8s");
    expect(formatDuration(3720000)).toEqual("1h 2m");
  });
});

describe("clip", () => {
  it("flattens whitespace and truncates past max with an ellipsis", () => {
    expect(clip("a b  c", 20)).toEqual("a b c");
    expect(clip("abcdef", 3)).toEqual("abc…");
  });
});

describe("parseAgentLogLine", () => {
  it("returns no entries for a blank line", () => {
    expect(parseAgentLogLine("   ")).toEqual([]);
  });

  it("classifies one wrapped line without the surrounding blob", () => {
    expect(parseAgentLogLine(wrapped(STATION_LOG))).toEqual([
      { kind: "station-log", text: "detect: scanning 42 specs" },
    ]);
  });

  it("keeps a non-JSON line raw", () => {
    expect(parseAgentLogLine(RUNNER_MARKER)).toEqual([
      { kind: "raw", text: RUNNER_MARKER },
    ]);
  });
});

describe("logEntriesFromValue", () => {
  it("classifies a decoded envelope the same as its serialized line", () => {
    const line = wrapped(ASSISTANT_TEXT);

    expect(logEntriesFromValue(JSON.parse(line), line)).toEqual(
      parseAgentLogLine(line),
    );
  });

  it("keeps a non-object value raw", () => {
    expect(logEntriesFromValue(42, "42")).toEqual([
      { kind: "raw", text: "42" },
    ]);
  });
});

describe("supersedesPrevious", () => {
  it("is true for a thinking-tokens entry following another", () => {
    const ticker: LogEntry = { kind: "thinking-tokens", tokens: 9 };
    const text: LogEntry = { kind: "assistant-text", text: "hi" };

    expect(supersedesPrevious(ticker, ticker)).toBe(true);
    expect(supersedesPrevious(text, ticker)).toBe(false);
    expect(supersedesPrevious(ticker, text)).toBe(false);
    expect(supersedesPrevious(undefined, ticker)).toBe(false);
  });
});

describe("lifecycle phase", () => {
  it("carries the init phase so the marker is not an unclassified line", () => {
    expect(parseAgentLog(LIFECYCLE_INIT_STARTED)).toEqual([
      { kind: "lifecycle", phase: "init", status: "started" },
    ]);
  });

  it("omits the phase when the marker carries none", () => {
    expect(parseAgentLog('{"kind":"lifecycle","status":"started"}')).toEqual([
      { kind: "lifecycle", status: "started" },
    ]);
  });
});

describe("rate_limit_event", () => {
  it("parses both unified windows with their utilization and reset time", () => {
    expect(parseAgentLog(RATE_LIMIT_EVENT)).toEqual([
      {
        kind: "rate-limit",
        status: "allowed_warning",
        windows: [
          { window: "five_hour", utilization: 0.07, resetsAt: 1787848200 },
          { window: "seven_day", utilization: 0.94, resetsAt: 1787882400 },
        ],
      },
    ]);
  });

  it("falls back to the single top-level window when there are no unified ones", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 0.5,
        resetsAt: 1787848200,
      },
    });

    expect(parseAgentLog(line)).toEqual([
      {
        kind: "rate-limit",
        status: "allowed",
        windows: [
          { window: "five_hour", utilization: 0.5, resetsAt: 1787848200 },
        ],
      },
    ]);
  });

  it("keeps a rate-limit line raw when it carries no readable window", () => {
    const line = '{"type":"rate_limit_event","rate_limit_info":{}}';

    expect(parseAgentLog(line)).toEqual([{ kind: "raw", text: line }]);
  });

  it("drops a unified window with no numeric utilization, keeping the rest", () => {
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        unifiedWindows: {
          seven_day: { resetsAt: 1787882400, utilization: 0.94 },
          five_hour: "not a window",
        },
      },
    });

    expect(parseAgentLog(line)).toEqual([
      {
        kind: "rate-limit",
        status: "allowed",
        windows: [
          { window: "seven_day", utilization: 0.94, resetsAt: 1787882400 },
        ],
      },
    ]);
  });

  it("keeps a rate-limit line raw when it carries no info at all", () => {
    const line = '{"type":"rate_limit_event"}';

    expect(parseAgentLog(line)).toEqual([{ kind: "raw", text: line }]);
  });
});

describe("rateLimitSummary", () => {
  it("names every window with its whole-percent utilization and status", () => {
    expect(
      rateLimitSummary({
        kind: "rate-limit",
        status: "allowed_warning",
        windows: [
          { window: "seven_day", utilization: 0.94, resetsAt: 1787882400 },
          { window: "five_hour", utilization: 0.07, resetsAt: null },
        ],
      }),
    ).toMatch(
      /^rate limit: seven_day 94%, resets .+ · five_hour 7% \(allowed_warning\)$/,
    );
  });

  it("omits the status when the event carries none", () => {
    expect(
      rateLimitSummary({
        kind: "rate-limit",
        status: "",
        windows: [{ window: "seven_day", utilization: 1, resetsAt: null }],
      }),
    ).toBe("rate limit: seven_day 100%");
  });
});

describe("hook events", () => {
  it("reads a hook_started line as a hook entry with no output yet", () => {
    expect(parseAgentLog(HOOK_STARTED_SESSION)).toEqual([
      {
        kind: "hook",
        hookId: "56eebdca-70de-4c3c-a5f3-d3f4f4ec2096",
        hookName: "SessionStart:startup",
        phase: "started",
        output: "",
      },
    ]);
  });

  it("carries outcome and exit code off a hook_response line", () => {
    expect(parseAgentLog(HOOK_RESPONSE_SESSION)).toEqual([
      {
        kind: "hook",
        hookId: "56eebdca-70de-4c3c-a5f3-d3f4f4ec2096",
        hookName: "SessionStart:startup",
        phase: "response",
        output: "[lore] station session started",
        outcome: "success",
        exitCode: 0,
      },
    ]);
  });

  it("keeps exit code 2 and a blocked outcome on a failed hook", () => {
    expect(parseAgentLog(HOOK_RESPONSE_FAILED)).toMatchObject({
      0: { phase: "response", outcome: "blocked", exitCode: 2 },
    });
  });

  it("folds a cumulative progress run into the last entry for that hook", () => {
    const entries = parseAgentLog(
      [
        HOOK_STARTED_BOOTSTRAP,
        HOOK_PROGRESS_BOOTSTRAP_FIRST,
        HOOK_PROGRESS_BOOTSTRAP_LAST,
        HOOK_RESPONSE_BOOTSTRAP,
      ].join("\n"),
    );

    expect(entries).toMatchObject({
      length: 1,
      0: {
        kind: "hook",
        hookId: "e628dd11-3b24-4aed-9618-2ca964d9156a",
        phase: "response",
        outcome: "success",
      },
    });
  });

  it("keeps two interleaved hooks apart, folding each on its own hook_id", () => {
    const entries = parseAgentLog(
      [
        HOOK_STARTED_SESSION,
        HOOK_STARTED_BOOTSTRAP,
        HOOK_RESPONSE_SESSION,
        HOOK_PROGRESS_BOOTSTRAP_FIRST,
        HOOK_PROGRESS_BOOTSTRAP_LAST,
        HOOK_RESPONSE_BOOTSTRAP,
      ].join("\n"),
    );

    expect(entries.map((e) => e.kind === "hook" && e.phase)).toEqual([
      "started",
      "started",
      "response",
      "response",
    ]);
  });

  it("does not fold a hook entry onto a different hook_id", () => {
    const session: LogEntry = {
      kind: "hook",
      hookId: "56eebdca-70de-4c3c-a5f3-d3f4f4ec2096",
      hookName: "SessionStart:startup",
      phase: "started",
      output: "",
    };
    const bootstrap: LogEntry = { ...session, hookId: "e628dd11" };

    expect(supersedesPrevious(session, session)).toBe(true);
    expect(supersedesPrevious(session, bootstrap)).toBe(false);
    expect(supersedesPrevious(undefined, session)).toBe(false);
  });
});

describe("tool progress heartbeats", () => {
  it("names the tool and its elapsed time off a tool_progress line", () => {
    expect(parseAgentLog(TOOL_PROGRESS_SKILL_FIRST)).toEqual([
      {
        kind: "tool-progress",
        toolUseId: "toolu_01U2T4eX8rrZghzWR3ETfD5X",
        toolName: "Skill",
        elapsedSeconds: 420,
      },
    ]);
  });

  it("folds a run of heartbeats for one call into its latest elapsed time", () => {
    expect(
      parseAgentLog(
        [TOOL_PROGRESS_SKILL_FIRST, TOOL_PROGRESS_SKILL_LAST].join("\n"),
      ),
    ).toEqual([
      {
        kind: "tool-progress",
        toolUseId: "toolu_01U2T4eX8rrZghzWR3ETfD5X",
        toolName: "Skill",
        elapsedSeconds: 600,
      },
    ]);
  });

  it("carries no elapsed time for a progress line that reports none", () => {
    const line = JSON.stringify({
      type: "tool_progress",
      tool_name: "Skill",
      tool_use_id: "toolu_01U2T4eX8rrZghzWR3ETfD5X",
    });

    expect(parseAgentLog(line)).toEqual([
      {
        kind: "tool-progress",
        toolUseId: "toolu_01U2T4eX8rrZghzWR3ETfD5X",
        toolName: "Skill",
      },
    ]);
  });

  it("does not fold a heartbeat onto a different tool call", () => {
    const skill: LogEntry = {
      kind: "tool-progress",
      toolUseId: "toolu_01U2T4eX8rrZghzWR3ETfD5X",
      toolName: "Skill",
      elapsedSeconds: 420,
    };
    const bash: LogEntry = { ...skill, toolUseId: "toolu_01MpZuAEpNbx" };

    expect(supersedesPrevious(skill, skill)).toBe(true);
    expect(supersedesPrevious(skill, bash)).toBe(false);
    expect(supersedesPrevious(undefined, skill)).toBe(false);
  });
});

describe("unrecognized system subtypes", () => {
  it("summarizes a compact_boundary line instead of dumping raw JSON", () => {
    expect(parseAgentLog(SYSTEM_COMPACT_BOUNDARY)).toEqual([
      {
        kind: "system",
        subtype: "compact_boundary",
        detailsJson: JSON.stringify(
          JSON.parse(SYSTEM_COMPACT_BOUNDARY),
          null,
          2,
        ),
      },
    ]);
  });

  it("keeps init and thinking_tokens on their own entries, not the fallback", () => {
    expect(parseAgentLog(SESSION_INIT)[0].kind).toBe("session-init");
    expect(parseAgentLog(THINKING_TOKENS_11)[0].kind).toBe("thinking-tokens");
  });
});

describe("gemini stream-json dialect", () => {
  it("parses the gemini init line to model gemini-3.1-pro-preview with pretty details", () => {
    expect(parseAgentLog(wrapped(GEMINI_INIT))).toEqual([
      {
        kind: "session-init",
        model: "gemini-3.1-pro-preview",
        detailsJson: JSON.stringify(JSON.parse(GEMINI_INIT), null, 2),
      },
    ]);
  });

  it("parses a gemini user message with string content as user-text", () => {
    expect(parseAgentLog(wrapped(GEMINI_USER_MESSAGE))).toEqual([
      {
        kind: "user-text",
        text: "Review pull request #1687 in re-cinq/lore (branch lore/implementation-loop/issue-1625).",
      },
    ]);
  });

  it("summarizes a top-level gemini tool_use from tool_name and parameters.command", () => {
    expect(parseAgentLog(wrapped(GEMINI_TOOL_USE))).toEqual([
      {
        kind: "tool-use",
        summary:
          "→ run_shell_command: git -C /workspace/target diff main...HEAD",
      },
    ]);
  });

  it("parses a gemini tool_result with status success as a non-error tool-result", () => {
    expect(parseAgentLog(wrapped(GEMINI_TOOL_RESULT_OK))).toEqual([
      {
        kind: "tool-result",
        text: "error: cannot run : No such file or directory\nfatal: external diff died, stopping at .lore/pr-body.md",
        isError: false,
      },
    ]);
  });

  it("parses a gemini tool_result with status error to the error message and isError true", () => {
    expect(parseAgentLog(wrapped(GEMINI_TOOL_RESULT_ERROR))).toEqual([
      {
        kind: "tool-result",
        text: "File not found: /workspace/target/missing.ts",
        isError: true,
      },
    ]);
  });

  it("merges consecutive delta chunks into one assistant-text entry", () => {
    const log = [
      wrapped(GEMINI_ASSISTANT_DELTA_FIRST),
      wrapped(GEMINI_ASSISTANT_DELTA_LAST),
    ].join("\n");

    expect(parseAgentLog(log)).toEqual([
      {
        kind: "assistant-text",
        text: "The PR adds a traceability link to the Rollout section.",
        delta: true,
      },
    ]);
  });

  it("does not merge delta chunks across an intervening tool_use", () => {
    const log = [
      wrapped(GEMINI_ASSISTANT_DELTA_FIRST),
      wrapped(GEMINI_TOOL_USE),
      wrapped(GEMINI_ASSISTANT_DELTA_LAST),
    ].join("\n");

    expect(parseAgentLog(log).map((entry) => entry.kind)).toEqual([
      "assistant-text",
      "tool-use",
      "assistant-text",
    ]);
  });

  it("parses a gemini error event to agent-error with severity error", () => {
    expect(parseAgentLog(wrapped(GEMINI_ERROR_EVENT))).toEqual([
      {
        kind: "agent-error",
        severity: "error",
        message: "Model gemini-2.5-pro not found for this API key",
      },
    ]);
  });

  it("parses a gemini result with status success as a non-error result", () => {
    expect(parseAgentLog(wrapped(GEMINI_RESULT_SUCCESS))).toEqual([
      { kind: "result", text: "", isError: false },
    ]);
  });

  it("parses a gemini result with status error to the error message and isError true", () => {
    expect(parseAgentLog(wrapped(GEMINI_RESULT_ERROR))).toEqual([
      { kind: "result", text: "Resource has been exhausted", isError: true },
    ]);
  });

  it("returns null from mergedDelta for a non-delta assistant entry", () => {
    const plain: LogEntry = { kind: "assistant-text", text: "done" };
    const delta: LogEntry = {
      kind: "assistant-text",
      text: " now",
      delta: true,
    };

    expect(mergedDelta(plain, plain)).toBeNull();
    expect(mergedDelta(undefined, delta)).toBeNull();
    expect(mergedDelta(plain, delta)).toEqual({
      kind: "assistant-text",
      text: "done now",
      delta: true,
    });
  });
});
