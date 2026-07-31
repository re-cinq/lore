import { describe, it, expect } from "vitest";
import {
  resultTextFromOutput,
  terminalErrorText,
  resultLine,
  eventLine,
  unwrapAttribution,
} from "./agent-output.js";
import { parseNodeResult } from "./node-outcome.js";

const logLine = (message: string) => JSON.stringify({ type: "log", message });
const bareResultLine = (result: string, isError = false) =>
  JSON.stringify({ type: "result", is_error: isError, result });
// The ai-agent-subsystem's attribution envelope (agentcore output/event.d):
// every stdout line of a pre-cutover CR arrives as {"source": {...}, "event": <line>}.
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
