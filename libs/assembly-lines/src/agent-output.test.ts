import { describe, it, expect } from "vitest";
import {
  resultTextFromOutput,
  terminalErrorText,
  agentStderrError,
  resultLine,
  eventLine,
  unwrapAttribution,
} from "./agent-output.js";
import { parseNodeResult } from "./node-outcome.js";

const logLine = (message: string) => JSON.stringify({ type: "log", message });
const bareResultLine = (result: string, isError = false) =>
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
    expect(resultTextFromOutput(bareResultLine("station failed", true))).toBe(
      "station failed",
    );
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

describe("terminalErrorText", () => {
  it("returns the last is_error result line's text", () => {
    const output = [
      logLine("starting"),
      bareResultLine("first error", true),
      bareResultLine("Credit balance is too low", true),
    ].join("\n");

    expect(terminalErrorText(output)).toBe("Credit balance is too low");
  });

  it("unwraps an is_error result nested in a {source,event} attribution envelope", () => {
    const output = attributedLine({
      type: "result",
      is_error: true,
      result: "Credit balance is too low",
    });

    expect(terminalErrorText(output)).toBe("Credit balance is too low");
  });

  it("returns null for a successful result, no result line, or empty output", () => {
    expect(terminalErrorText(bareResultLine("ok"))).toBeNull();
    expect(terminalErrorText(logLine("x"))).toBeNull();
    expect(terminalErrorText("")).toBeNull();
    expect(terminalErrorText(undefined)).toBeNull();
    expect(terminalErrorText("not json at all")).toBeNull();
  });

  it("caps the text at 300 chars so a stack dump never floods a notification", () => {
    const output = bareResultLine("x".repeat(500), true);

    expect(terminalErrorText(output)?.length).toBe(300);
  });
});

describe("unwrapAttribution", () => {
  const resultEvent = { type: "result", is_error: false, result: "done" };

  it("returns the event and source of a single {source,event} envelope", () => {
    expect(
      unwrapAttribution({ source: { task: "t1" }, event: resultEvent }),
    ).toEqual({ source: { task: "t1" }, event: resultEvent });
  });

  it("peels both layers of a double-wrapped envelope", () => {
    expect(
      unwrapAttribution({
        source: { task: "t1" },
        event: { source: { task: "t1" }, event: resultEvent },
      }),
    ).toEqual({ source: { task: "t1" }, event: resultEvent });
  });

  it("merges double-wrap source fields with the outer envelope winning", () => {
    expect(
      unwrapAttribution({
        source: { task: "outer-task", agent: "outer-agent" },
        event: {
          source: { task: "inner-task", pod: "inner-pod" },
          event: resultEvent,
        },
      }),
    ).toEqual({
      source: { task: "outer-task", agent: "outer-agent", pod: "inner-pod" },
      event: resultEvent,
    });
  });

  it("takes an inner source field the outer envelope leaves undefined", () => {
    expect(
      unwrapAttribution({
        source: { agent: "outer-agent" },
        event: { source: { task: "inner-task" }, event: resultEvent },
      }).source,
    ).toEqual({ task: "inner-task", agent: "outer-agent" });
  });

  it("returns a null source when neither envelope source is an object", () => {
    expect(
      unwrapAttribution({
        source: "agent-1",
        event: { source: null, event: resultEvent },
      }),
    ).toEqual({ source: null, event: resultEvent });
  });

  it("leaves a third envelope layer intact as the event", () => {
    const third = { source: { task: "t1" }, event: resultEvent };

    expect(
      unwrapAttribution({
        source: { task: "t1" },
        event: { source: { task: "t1" }, event: third },
      }),
    ).toEqual({ source: { task: "t1" }, event: third });
  });

  it("returns a null source and the value itself for a bare line with no envelope", () => {
    expect(unwrapAttribution(resultEvent)).toEqual({
      source: null,
      event: resultEvent,
    });
    expect(unwrapAttribution("raw stdout text")).toEqual({
      source: null,
      event: "raw stdout text",
    });
  });

  it("returns a null source when the envelope source is not an object", () => {
    expect(
      unwrapAttribution({ source: "agent-1", event: resultEvent }),
    ).toEqual({ source: null, event: resultEvent });
  });

  it("returns a null source when only the inner envelope source is an object", () => {
    expect(
      unwrapAttribution({
        source: "agent-1",
        event: { source: { task: "t1" }, event: resultEvent },
      }),
    ).toEqual({ source: { task: "t1" }, event: resultEvent });
  });
});

describe("resultLine", () => {
  it("emits the claude-style terminal event carrying the LORE_NODE_RESULT payload", () => {
    const line = resultLine({
      outcome: "success",
      extras: { "Lore-Validation": "passed" },
    });
    const event = JSON.parse(line);

    expect(event).toMatchObject({ type: "result", is_error: false });
    expect(event.result).toMatch(/^LORE_NODE_RESULT: /);
  });

  it("round-trips through parseNodeResult", () => {
    const line = resultLine({
      outcome: "failed",
      extras: { "Lore-Validation-Failed": "lint" },
    });

    expect(parseNodeResult(JSON.parse(line).result)).toEqual({
      outcome: "failed",
      extras: { "Lore-Validation-Failed": "lint" },
    });
  });

  it("round-trips through resultTextFromOutput", () => {
    const line = resultLine({ outcome: "success", extras: {} });

    expect(resultTextFromOutput(line)).toBe(
      'LORE_NODE_RESULT: {"outcome":"success","extras":{}}',
    );
  });

  it("marks infrastructure errors is_error so the CR fails", () => {
    const line = resultLine(null, "clone exploded");

    expect(JSON.parse(line)).toEqual({
      type: "result",
      is_error: true,
      result: "clone exploded",
    });
  });

  it("throws when asked to wrap an already-wrapped result line", () => {
    const alreadyWrapped = resultLine(null, "boom");

    expect(() => resultLine(null, alreadyWrapped)).toThrow(
      /already-wrapped agent output/,
    );
  });

  it("throws when asked to wrap a {source,event} attribution envelope", () => {
    const alreadyWrapped = attributedLine({ type: "result", result: "x" });

    expect(() => resultLine(null, alreadyWrapped)).toThrow(
      /already-wrapped agent output/,
    );
  });
});

describe("eventLine", () => {
  it("emits a log event that resultTextFromOutput skips over", () => {
    const stream = [
      eventLine("cloning repo"),
      resultLine({ outcome: "success", extras: {} }),
    ].join("\n");

    expect(JSON.parse(eventLine("cloning repo"))).toEqual({
      type: "log",
      message: "cloning repo",
    });
    expect(resultTextFromOutput(stream)).toBe(
      'LORE_NODE_RESULT: {"outcome":"success","extras":{}}',
    );
  });
});

describe("resultLine LLM usage", () => {
  const usage = {
    inputTokens: 812,
    outputTokens: 41,
    costUsd: 0.0008,
    durationMs: 950,
    model: "claude-haiku-4-5-20251001",
  };

  it("lifts reported usage onto the terminal line as the cost sink's claude-style fields", () => {
    const event = JSON.parse(
      resultLine({ outcome: "success", extras: { action: "answer" }, usage }),
    );

    expect(event).toMatchObject({
      type: "result",
      is_error: false,
      model: "claude-haiku-4-5-20251001",
      usage: { input_tokens: 812, output_tokens: 41 },
      total_cost_usd: 0.0008,
      duration_ms: 950,
    });
  });

  it("keeps usage out of the LORE_NODE_RESULT payload", () => {
    const event = JSON.parse(
      resultLine({ outcome: "success", extras: {}, usage }),
    );

    expect(parseNodeResult(event.result)).toEqual({
      outcome: "success",
      extras: {},
    });
  });

  it("emits a usage-less terminal line unchanged when the node reported none", () => {
    expect(JSON.parse(resultLine({ outcome: "success", extras: {} }))).toEqual({
      type: "result",
      is_error: false,
      result: 'LORE_NODE_RESULT: {"outcome":"success","extras":{}}',
    });
  });
});

describe("agentStderrError", () => {
  const bootCrash = [
    '{"kind":"lifecycle","phase":"agent","status":"started"}',
    "[agent] Error: Settings file not found: /agent/.claude/settings.json",
    '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
  ].join("\n");

  it("returns the relayed stderr line of a run the lifecycle says failed", () => {
    expect(agentStderrError(bootCrash)).toBe(
      "Error: Settings file not found: /agent/.claude/settings.json",
    );
  });

  it("returns the LAST relayed line, which is the one that killed it", () => {
    const output = [
      '{"kind":"lifecycle","phase":"agent","status":"started"}',
      "[agent] warming up",
      "[agent] Error: Settings file not found: /agent/.claude/settings.json",
      '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
    ].join("\n");

    expect(agentStderrError(output)).toBe(
      "Error: Settings file not found: /agent/.claude/settings.json",
    );
  });

  it("says nothing about a run the lifecycle never reported as failed", () => {
    const output = [
      '{"kind":"lifecycle","phase":"agent","status":"started"}',
      "[agent] warming up",
      '{"kind":"lifecycle","exitCode":0,"phase":"agent","status":"succeeded"}',
    ].join("\n");

    expect(agentStderrError(output)).toBeNull();
  });

  it("ignores model prose and tool output (e.g. a fetched page quoting '403 Forbidden'), reading only the runner's own prefix", () => {
    const output = [
      '{"kind":"lifecycle","phase":"agent","status":"started"}',
      JSON.stringify({ type: "assistant", message: "403 Forbidden somewhere" }),
      "not a prefixed line either",
      '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
    ].join("\n");

    expect(agentStderrError(output)).toBeNull();
  });

  it("says nothing when the phase that failed was not the agent's (init-phase death has its own markers)", () => {
    const output = [
      '{"kind":"lifecycle","phase":"init","status":"started"}',
      "[agent] Error: Settings file not found: /agent/.claude/settings.json",
      '{"kind":"lifecycle","exitCode":1,"phase":"init","status":"failed"}',
    ].join("\n");

    expect(agentStderrError(output)).toBeNull();
  });

  it("still reads a failed envelope that names no phase at all (phase is optional on the lifecycle marker)", () => {
    const output = [
      "[agent] Error: Settings file not found: /agent/.claude/settings.json",
      '{"kind":"lifecycle","exitCode":1,"status":"failed"}',
    ].join("\n");

    expect(agentStderrError(output)).toBe(
      "Error: Settings file not found: /agent/.claude/settings.json",
    );
  });

  it("reads the line that preceded the failure, not one logged after it (a shutdown line printed after the engine died is not what killed it)", () => {
    const output = [
      "[agent] Error: Settings file not found: /agent/.claude/settings.json",
      '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
      "[agent] cleaning up",
    ].join("\n");

    expect(agentStderrError(output)).toBe(
      "Error: Settings file not found: /agent/.claude/settings.json",
    );
  });

  it("returns null for empty, absent, or unstructured output", () => {
    expect(agentStderrError("")).toBeNull();
    expect(agentStderrError(undefined)).toBeNull();
    expect(agentStderrError("not json at all")).toBeNull();
  });

  it("caps the text at 300 chars, like the result-line reader", () => {
    const output = [
      `[agent] ${"x".repeat(500)}`,
      '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
    ].join("\n");

    expect(agentStderrError(output)).toHaveLength(300);
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
