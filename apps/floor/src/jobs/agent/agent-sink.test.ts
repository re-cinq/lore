import { describe, it, expect } from "vitest";
import { parseAgentSink } from "./agent-events.js";
import { MAX_RUN_EVENTS_PER_BATCH } from "./agent-run-events.js";

const src = { task: "task-uuid-1", agent: "cr-1" };
const line = (event: unknown): string => JSON.stringify({ source: src, event });
const result = (usage: unknown): unknown => ({
  type: "result",
  subtype: "success",
  usage,
});
const textBlocks = (count: number): unknown[] =>
  Array.from({ length: count }, () => ({ type: "text", text: "x" }));
const assistant = (content: unknown[]): unknown => ({
  type: "assistant",
  message: { content },
});

describe("parseAgentSink", () => {
  it("projects both cost and viz rows in one pass, capping viz at MAX_RUN_EVENTS_PER_BATCH", () => {
    const body = [
      line(assistant(textBlocks(MAX_RUN_EVENTS_PER_BATCH + 5))),
      line(result({ input_tokens: 10 })),
    ].join("\n");

    const sink = parseAgentSink(body);

    expect(sink.costRows).toHaveLength(1);
    expect(sink.runEvents).toHaveLength(MAX_RUN_EVENTS_PER_BATCH);
  });

  it("skips viz projection entirely when run-event projection is off", () => {
    const body = [
      line(assistant([{ type: "text", text: "hi" }])),
      line(result({ input_tokens: 10 })),
    ].join("\n");

    const sink = parseAgentSink(body, false);

    expect(sink.costRows).toHaveLength(1);
    expect(sink.runEvents).toEqual([]);
  });
});
