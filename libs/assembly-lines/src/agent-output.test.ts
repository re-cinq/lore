import { describe, it, expect } from "vitest";
import { resultTextFromOutput, eventLine } from "./agent-output.js";

const logLine = (message: string) => JSON.stringify({ type: "log", message });
const bareResultLine = (result: string, { isError = false } = {}) =>
  JSON.stringify({ type: "result", is_error: isError, result });
const attributedLine = (event: unknown) =>
  JSON.stringify({
    source: {
      agent: "0a6c5d0b-review",
      station: "pt-0a6c5d0b",
      task: "0a6c5d0b-5ea0-4d98-85e2-0bb6b29fa03b",
      pod: "agent-job-0a6c5d0b-review-pckpz",
      namespace: "ai-agents",
    },
    event,
  });

describe("resultTextFromOutput", () => {
  it("returns the agent text from a terminal result line", () => {
    expect(resultTextFromOutput(bareResultLine("REVIEW_RESULT:APPROVED"))).toBe(
      "REVIEW_RESULT:APPROVED",
    );
  });

  it("restores real newlines that the NDJSON encoding escaped", () => {
    const agentText =
      'Analysis.\n\n```REVIEW_FINDINGS\n{"verdict":"approved"}\n```';

    expect(resultTextFromOutput(bareResultLine(agentText))).toBe(agentText);
  });

  it("skips log lines and returns the terminal result of a stream", () => {
    const stream = [
      logLine("cloning repo"),
      logLine("running claude"),
      bareResultLine('LORE_NODE_RESULT: {"outcome":"success"}'),
    ].join("\n");

    expect(resultTextFromOutput(stream)).toBe(
      'LORE_NODE_RESULT: {"outcome":"success"}',
    );
  });

  it("returns the last result line when a stream carries several", () => {
    const stream = [bareResultLine("first"), bareResultLine("second")].join(
      "\n",
    );

    expect(resultTextFromOutput(stream)).toBe("second");
  });

  it("returns the error text of an is_error result line", () => {
    expect(
      resultTextFromOutput(bareResultLine("station failed", { isError: true })),
    ).toBe("station failed");
  });

  it("returns plain non-NDJSON output unchanged", () => {
    expect(resultTextFromOutput("REVIEW_RESULT:APPROVED")).toBe(
      "REVIEW_RESULT:APPROVED",
    );
  });

  it("returns the raw stream when no line is a result line", () => {
    const stream = [logLine("a"), logLine("b")].join("\n");

    expect(resultTextFromOutput(stream)).toBe(stream);
  });

  it("ignores unparseable lines around the result line", () => {
    const stream = [
      "not json at all",
      bareResultLine("done"),
      "}{ broken",
    ].join("\n");

    expect(resultTextFromOutput(stream)).toBe("done");
  });

  it("returns an empty string for empty output", () => {
    expect(resultTextFromOutput("")).toBe("");
  });

  it("returns the raw output when a result line carries no string result", () => {
    const stream = JSON.stringify({ type: "result", is_error: false });

    expect(resultTextFromOutput(stream)).toBe(stream);
  });

  it("unwraps a result line nested in a {source,event} attribution envelope", () => {
    const agentText =
      'Compiled review.\n\n```REVIEW_FINDINGS\n{"verdict":"approved","findings":[]}\n```';
    const line = attributedLine({
      type: "result",
      is_error: false,
      result: agentText,
    });

    expect(resultTextFromOutput(line)).toBe(agentText);
  });

  it("returns the attributed result of a pre-cutover CR stream that ends with a lifecycle event", () => {
    const stream = [
      attributedLine({ type: "log", message: "cloning repo" }),
      attributedLine({
        type: "result",
        is_error: false,
        result:
          'REVIEW_RESULT:CHANGES_REQUESTED\n```REVIEW_FINDINGS\n{"verdict":"changes_requested","findings":[]}\n```',
      }),
      attributedLine({
        kind: "lifecycle",
        exitCode: 0,
        phase: "agent",
        status: "succeeded",
      }),
    ].join("\n");

    expect(resultTextFromOutput(stream)).toBe(
      'REVIEW_RESULT:CHANGES_REQUESTED\n```REVIEW_FINDINGS\n{"verdict":"changes_requested","findings":[]}\n```',
    );
  });

  it("returns the raw stream when attributed events carry no result line", () => {
    const stream = [
      attributedLine({ kind: "lifecycle", status: "running" }),
      attributedLine({ type: "log", message: "working" }),
    ].join("\n");

    expect(resultTextFromOutput(stream)).toBe(stream);
  });
});

describe("eventLine", () => {
  it("emits a log event that resultTextFromOutput skips over", () => {
    const stream = [
      eventLine("cloning repo"),
      bareResultLine("REVIEW_RESULT:APPROVED"),
    ].join("\n");

    expect(JSON.parse(eventLine("cloning repo"))).toEqual({
      type: "log",
      message: "cloning repo",
    });
    expect(resultTextFromOutput(stream)).toBe("REVIEW_RESULT:APPROVED");
  });
});

describe("the gemini result shape (run 6cb4b352, 2026-09-02: assistant delta chunks carry the text, then a stats-only result line)", () => {
  const geminiStream = [
    `{"type":"tool_call","name":"read_file"}`,
    `{"type":"message","role":"assistant","content":"\`\`\`REVIEW_FINDINGS\\n{\\n  \\"verdict\\": \\"changes_requested\\",\\n","delta":true}`,
    `{"type":"message","role":"assistant","content":"  \\"findings\\": []\\n}\\n\`\`\`\\n\\n","delta":true}`,
    `{"type":"message","role":"assistant","content":"REVIEW_RESULT:CHANGES_REQUESTED:tighten the guard","delta":true}`,
    `{"type":"result","timestamp":"2026-09-02T07:11:49Z","status":"success","stats":{"total_tokens":9}}`,
  ].join("\n");

  it("reassembles the final assistant message when the result line carries no text", () => {
    expect(resultTextFromOutput(geminiStream)).toEqual(
      '```REVIEW_FINDINGS\n{\n  "verdict": "changes_requested",\n' +
        '  "findings": []\n}\n```\n\n' +
        "REVIEW_RESULT:CHANGES_REQUESTED:tighten the guard",
    );
  });

  it("stops at the first non-assistant event, so a marker mentioned in an earlier turn cannot shadow the block actually written", () => {
    const withEarlierMention = [
      `{"type":"message","role":"assistant","content":"I will write a REVIEW_FINDINGS block now.","delta":true}`,
      `{"type":"tool_call","name":"write_file"}`,
      `{"type":"message","role":"assistant","content":"done","delta":true}`,
      `{"type":"result","status":"success"}`,
    ].join("\n");

    expect(resultTextFromOutput(withEarlierMention)).toEqual("done");
  });

  it("falls back to the raw output when a text-less result has no assistant chunks before it", () => {
    const bare = `{"type":"result","status":"error"}`;

    expect(resultTextFromOutput(bare)).toEqual(bare);
  });

  it("still prefers the claude-style result text when both shapes appear", () => {
    const claude = [
      `{"type":"message","role":"assistant","content":"chunk","delta":true}`,
      `{"type":"result","is_error":false,"result":"the final text"}`,
    ].join("\n");

    expect(resultTextFromOutput(claude)).toEqual("the final text");
  });
});
