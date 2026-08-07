// The turn-collection half of parseAgentSink (specs/turn-level-transcript-store
// FR3), kept out of agent-sink.test.ts because that file carries #L anchors
// from specs/assembly-line-run-viz that any insertion would silently shift.

import { describe, it, expect } from "vitest";
import { parseAgentSink } from "./agent-events.js";
import { MAX_RUN_TURNS_PER_BATCH } from "./agent-run-turns.js";

const src = { task: "task-uuid-1", agent: "cr-1" };
const line = (event: unknown): string => JSON.stringify({ source: src, event });
const assistant = (content: unknown[]): unknown => ({
  type: "assistant",
  message: { content },
});
const body = [
  line(assistant([{ type: "text", text: "hi" }])),
  line({ type: "result", subtype: "success", usage: { input_tokens: 10 } }),
].join("\n");

describe("parseAgentSink turn collection", () => {
  it("collects no turn unless turn collection is asked for", () => {
    expect(parseAgentSink(body).turns).toEqual([]);
  });

  it("leaves the cost rows and viz rows identical whether turns are collected or not", () => {
    const off = parseAgentSink(body, true, false);
    const on = parseAgentSink(body, true, true);

    expect(on.costRows).toEqual(off.costRows);
    expect(on.runEvents).toEqual(off.runEvents);
  });

  it("collects one turn per stream-json line in the same pass as the cost rows", () => {
    const sink = parseAgentSink(body, true, true);

    expect(sink.costRows).toHaveLength(1);
    expect(sink.turns.map((turn) => turn.eventType)).toEqual([
      "assistant",
      "result",
    ]);
  });

  it("collects the raw line verbatim, untruncated, as the turn envelope", () => {
    const sink = parseAgentSink(body, true, true);

    expect(sink.turns.map((turn) => turn.envelope)).toEqual(body.split("\n"));
  });

  it("collects a turn for a line the viz projection drops as an unknown kind", () => {
    const sink = parseAgentSink(line({ type: "brand_new_kind" }), true, true);

    expect(sink.runEvents).toEqual([]);
    expect(sink.turns).toHaveLength(1);
  });

  it("caps collected turns at MAX_RUN_TURNS_PER_BATCH", () => {
    const many = Array.from({ length: MAX_RUN_TURNS_PER_BATCH + 5 }, () =>
      line(assistant([{ type: "text", text: "x" }])),
    ).join("\n");

    expect(parseAgentSink(many, false, true).turns).toHaveLength(
      MAX_RUN_TURNS_PER_BATCH,
    );
  });
});
