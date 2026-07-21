import { describe, it, expect } from "vitest";
import {
  parseAgentRunEvents,
  MAX_RUN_EVENTS_PER_BATCH,
} from "./agent-run-events.js";

const textBlocks = (count: number): unknown[] =>
  Array.from({ length: count }, () => ({ type: "text", text: "x" }));

const assistantLine = (blocks: unknown[]): string =>
  JSON.stringify({
    source: { task: "task-uuid-1", agent: "cr-1" },
    event: { type: "assistant", message: { content: blocks } },
  });

describe("parseAgentRunEvents row cap", () => {
  it("stops at MAX_RUN_EVENTS_PER_BATCH rows for an oversized run", () => {
    // First line overfills within one line (inner cap); the second line is
    // reached already at the cap (outer cap, stops scanning further lines).
    const rows = parseAgentRunEvents(
      [
        assistantLine(textBlocks(MAX_RUN_EVENTS_PER_BATCH + 5)),
        assistantLine(textBlocks(3)),
      ].join("\n"),
    );

    expect(rows).toHaveLength(MAX_RUN_EVENTS_PER_BATCH);
  });
});
