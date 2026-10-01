import { describe, it, expect } from "vitest";
import { parseAgentSink } from "./agent-events.js";
import { MAX_RUN_EVENTS_PER_BATCH } from "@re-cinq/lore-shared/agent-stream/agent-run-events.js";

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

  it("skips viz projection entirely when run-event projection is off, exercising the no-remainder path via a trailing newline", () => {
    const body =
      [
        line(assistant([{ type: "text", text: "hi" }])),
        line(result({ input_tokens: 10 })),
      ].join("\n") + "\n";

    const sink = parseAgentSink(body, { projectRunEvents: false });

    expect(sink.costRows).toHaveLength(1);
    expect(sink.runEvents).toEqual([]);
  });
});

describe("parseAgentSink redaction (#2013)", () => {
  const token = `${"ghs"}_abcdefghijklmnopqrstuvwxyz0123456789`;
  const basic =
    "Basic eC1hY2Nlc3MtdG9rZW46Z2hzX2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6";
  const body = [
    line(
      assistant([
        {
          type: "tool_use",
          id: "tu-1",
          name: "Bash",
          input: { command: `curl -H "Authorization: token ${token}" api` },
        },
      ]),
    ),
    line({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: `extraheader = AUTHORIZATION: ${basic}`,
          },
        ],
      },
    }),
    line(result({ input_tokens: 10 })),
  ].join("\n");

  it("stores redacted summaries and payloads in run events and turns", () => {
    const sink = parseAgentSink(body);
    const [call, toolResult] = sink.runEvents;

    expect({
      callSummary: String(call.summary).includes("[REDACTED:api-key]"),
      callPayload: JSON.stringify(call.payload).includes("[REDACTED:api-key]"),
      resultPayload: JSON.stringify(toolResult.payload).includes("[REDACTED:"),
      costRows: sink.costRows.length,
      turns: sink.turns.length,
    }).toEqual({
      callSummary: true,
      callPayload: true,
      resultPayload: true,
      costRows: 1,
      turns: 3,
    });
  });

  it("leaves neither secret anywhere in the stored run events or turns", () => {
    const sink = parseAgentSink(body);
    const stored = JSON.stringify([sink.runEvents, sink.turns]);

    expect(stored).not.toContain(token);
    expect(stored).not.toContain("eC1hY2Nlc3MtdG9rZW46");
  });
});
