import { describe, it, expect } from "vitest";
import {
  parseAgentLog,
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
      { kind: "lifecycle", status: "started" },
      { kind: "lifecycle", status: "succeeded", exitCode: 0 },
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
