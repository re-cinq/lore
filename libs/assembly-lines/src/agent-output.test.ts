import { describe, it, expect } from "vitest";
import { resultTextFromOutput } from "./agent-output.js";

const logLine = (message: string) => JSON.stringify({ type: "log", message });
const resultLine = (result: string, isError = false) =>
  JSON.stringify({ type: "result", is_error: isError, result });

describe("resultTextFromOutput", () => {
  it("returns the agent text from a terminal result line", () => {
    expect(resultTextFromOutput(resultLine("REVIEW_RESULT:APPROVED"))).toBe(
      "REVIEW_RESULT:APPROVED",
    );
  });

  it("restores real newlines that the NDJSON encoding escaped", () => {
    const agentText =
      'Analysis.\n\n```REVIEW_FINDINGS\n{"verdict":"approved"}\n```';

    expect(resultTextFromOutput(resultLine(agentText))).toBe(agentText);
  });

  it("skips log lines and returns the terminal result of a stream", () => {
    const stream = [
      logLine("cloning repo"),
      logLine("running claude"),
      resultLine('LORE_NODE_RESULT: {"outcome":"success"}'),
    ].join("\n");

    expect(resultTextFromOutput(stream)).toBe(
      'LORE_NODE_RESULT: {"outcome":"success"}',
    );
  });

  it("returns the last result line when a stream carries several", () => {
    const stream = [resultLine("first"), resultLine("second")].join("\n");

    expect(resultTextFromOutput(stream)).toBe("second");
  });

  it("returns the error text of an is_error result line", () => {
    expect(resultTextFromOutput(resultLine("station failed", true))).toBe(
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
    const stream = ["not json at all", resultLine("done"), "}{ broken"].join(
      "\n",
    );

    expect(resultTextFromOutput(stream)).toBe("done");
  });

  it("returns an empty string for empty output", () => {
    expect(resultTextFromOutput("")).toBe("");
  });

  it("returns the raw output when a result line carries no string result", () => {
    const stream = JSON.stringify({ type: "result", is_error: false });

    expect(resultTextFromOutput(stream)).toBe(stream);
  });
});
