import { describe, it, expect } from "vitest";
import { resultLine } from "@re-cinq/lore-assembly-lines";
import { parseAgentEvents, agentEventsArchiveKey } from "./agent-events.js";

const line = (source: unknown, event: unknown): string =>
  JSON.stringify({ source, event });
const src = { task: "task-uuid-1", agent: "agent-abc", pod: "p" };
const result = (extra: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  ...extra,
});

describe("parseAgentEvents", () => {
  it("maps a terminal result event to one llm_calls row", () => {
    const ndjson = line(
      src,
      result({
        modelUsage: { "claude-sonnet-4-6": {} },
        usage: { input_tokens: 1200, output_tokens: 340 },
        total_cost_usd: 0.0185,
        duration_ms: 42000,
      }),
    );

    expect(parseAgentEvents(ndjson)).toEqual([
      {
        taskId: "task-uuid-1",
        agentCrName: "agent-abc",
        model: "claude-sonnet-4-6",
        inputTokens: 1200,
        outputTokens: 340,
        costUsd: 0.0185,
        durationMs: 42000,
      },
    ]);
  });

  it("falls back to a flat model field, then to unknown", () => {
    const flat = line(
      src,
      result({ model: "claude-haiku-4-5", usage: { input_tokens: 1 } }),
    );

    expect(parseAgentEvents(flat)[0].model).toBe("claude-haiku-4-5");
    const empty = line(src, result({ modelUsage: {}, usage: {} }));

    expect(parseAgentEvents(empty)[0].model).toBe("unknown");
  });

  it("defaults missing usage/cost/duration numbers to zero", () => {
    expect(parseAgentEvents(line(src, result({ usage: {} })))[0]).toMatchObject(
      {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      },
    );
  });

  it("ignores non-result events, and results with no usage", () => {
    const ndjson = [
      line(src, { type: "assistant", message: { content: [] } }),
      line(src, { type: "system", subtype: "init" }),
      line(src, result({ total_cost_usd: 1 })),
    ].join("\n");

    expect(parseAgentEvents(ndjson)).toEqual([]);
  });

  it("skips lines with no resolvable task id", () => {
    const noTask = line({ agent: "a" }, result({ usage: {} }));
    const stringSource = line("not-an-object", result({ usage: {} }));

    expect(parseAgentEvents(`${noTask}\n${stringSource}`)).toEqual([]);
  });

  it("skips non-object envelopes, string events, blank and unparseable lines", () => {
    const ndjson = [
      "",
      "  ",
      "5",
      "{not json",
      line(src, "raw stdout text"),
    ].join("\n");

    expect(parseAgentEvents(ndjson)).toEqual([]);
  });

  it("maps a double-wrapped result event to one llm_calls row", () => {
    const ndjson = JSON.stringify({
      source: src,
      event: {
        source: { task: "task-uuid-1", agent: "agent-abc" },
        event: result({
          modelUsage: { "claude-sonnet-4-6": {} },
          usage: { input_tokens: 1200, output_tokens: 340 },
          total_cost_usd: 0.0185,
          duration_ms: 42000,
        }),
      },
    });

    expect(parseAgentEvents(ndjson)).toEqual([
      {
        taskId: "task-uuid-1",
        agentCrName: "agent-abc",
        model: "claude-sonnet-4-6",
        inputTokens: 1200,
        outputTokens: 340,
        costUsd: 0.0185,
        durationMs: 42000,
      },
    ]);
  });

  it("resolves the task id from the inner envelope when the outer carries none", () => {
    const ndjson = JSON.stringify({
      source: { agent: "agent-abc" },
      event: { source: src, event: result({ usage: { input_tokens: 5 } }) },
    });

    expect(parseAgentEvents(ndjson)[0]).toMatchObject({
      taskId: "task-uuid-1",
      inputTokens: 5,
    });
  });

  it("skips a triple-wrapped line, since the peel stops at two envelopes", () => {
    const ndjson = JSON.stringify({
      source: src,
      event: {
        source: src,
        event: { source: src, event: result({ usage: { input_tokens: 1 } }) },
      },
    });

    expect(parseAgentEvents(ndjson)).toEqual([]);
  });

  it("emits a row per run across multiple lines", () => {
    const a = line(
      { task: "t-a" },
      result({ usage: { input_tokens: 10 }, total_cost_usd: 0.1 }),
    );
    const b = line(
      { task: "t-b" },
      result({ usage: { input_tokens: 20 }, total_cost_usd: 0.2 }),
    );

    expect(parseAgentEvents(`${a}\n${b}`).map((r) => r.taskId)).toEqual([
      "t-a",
      "t-b",
    ]);
  });
});

describe("agentEventsArchiveKey", () => {
  it("builds a date-partitioned key from the received instant and first task id", () => {
    expect(
      agentEventsArchiveKey("2026-06-29T22:45:01.123Z", ["task-uuid-1", "t-b"]),
    ).toBe(
      "__agent_events__/2026-06-29/2026-06-29T22-45-01-123Z-task-uuid-1.ndjson",
    );
  });

  it("tags the key 'unknown' when the batch carries no task ids", () => {
    expect(agentEventsArchiveKey("2026-06-29T22:45:01.123Z", [])).toBe(
      "__agent_events__/2026-06-29/2026-06-29T22-45-01-123Z-unknown.ndjson",
    );
  });
});

describe("parseAgentEvents on a station terminal line", () => {
  it("maps a station result line carrying usage to one llm_calls row", () => {
    const stationLine = resultLine({
      outcome: "success",
      extras: { action: "answer" },
      usage: {
        inputTokens: 812,
        outputTokens: 41,
        costUsd: 0.0008,
        durationMs: 950,
        model: "claude-haiku-4-5-20251001",
      },
    });

    expect(
      parseAgentEvents(
        line(
          { task: "al-uuid-1", agent: "abc123-triage" },
          JSON.parse(stationLine),
        ),
      ),
    ).toEqual([
      {
        taskId: "al-uuid-1",
        agentCrName: "abc123-triage",
        model: "claude-haiku-4-5-20251001",
        inputTokens: 812,
        outputTokens: 41,
        costUsd: 0.0008,
        durationMs: 950,
      },
    ]);
  });

  it("yields no cost row for a station result line whose envelope carries no usage field", () => {
    const stationLine = resultLine({ outcome: "success", extras: {} });

    expect(parseAgentEvents(line(src, JSON.parse(stationLine)))).toEqual([]);
  });
});
