import { describe, it, expect } from "vitest";
import { resultTextFromOutput, resultLine, eventLine } from "./agent-output.js";
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

  it("never unwraps a {source,event} attribution envelope — sink-lane lines fall through raw", () => {
    const stream = [
      attributedLine({ kind: "lifecycle", status: "running" }),
      attributedLine({ type: "result", is_error: false, result: "sink copy" }),
    ].join("\n");

    expect(resultTextFromOutput(stream)).toBe(stream);
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
