import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerUsageTools } from "./usage-tools.js";

/**
 * Drives the actual registered lore_my_usage / lore_get_analytics handlers via a fake
 * McpServer that captures the handler, and a recording pg pool whose `query`
 * matches on the inline SQL and returns canned rows. No logic is mocked — the
 * handler's period fan-out, SQL shape, and JSON envelope are exercised end to
 * end.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
}>;

const originalEnv = { ...process.env };

interface RecordedQuery {
  text: string;
  params?: unknown[];
}

function registerWith(getPool: () => unknown) {
  const handlers: Record<string, ToolHandler> = {};
  const fakeServer = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      handlers[name] = handler;
    },
  };
  registerUsageTools(fakeServer as never, { getPool });
  return handlers;
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("lore_my_usage", () => {
  beforeEach(() => {
    process.env.LORE_AGENT_ID = "agent-12345678-abcd";
  });

  it("returns per-period task and token totals as JSON", async () => {
    const queries: RecordedQuery[] = [];
    let call = 0;
    const rowsByCall = [
      { tasks: 2, input_tokens: "100", output_tokens: "50" },
      { tasks: 9, input_tokens: "900", output_tokens: "450" },
      { tasks: 30, input_tokens: "3000", output_tokens: "1500" },
    ];
    const pool = {
      query: async (text: string, params?: unknown[]) => {
        queries.push({ text, params });
        return { rows: [rowsByCall[call++]] };
      },
    };
    const usage = registerWith(() => pool)["lore_my_usage"];

    const result = await usage({ agent_id: "agent-12345678-abcd" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      agent_id: "agent-12345678-abcd",
      usage: {
        today: { tasks: 2, input_tokens: 100, output_tokens: 50 },
        "7_day": { tasks: 9, input_tokens: 900, output_tokens: 450 },
        "30_day": { tasks: 30, input_tokens: 3000, output_tokens: 1500 },
      },
    });
  });

  it("issues one query per period with the agent id and 8-char LIKE prefix params", async () => {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string, params?: unknown[]) => {
        queries.push({ text, params });
        return { rows: [{ tasks: 0, input_tokens: "0", output_tokens: "0" }] };
      },
    };
    const usage = registerWith(() => pool)["lore_my_usage"];

    await usage({ agent_id: "agent-12345678-abcd" });

    expect(queries).toHaveLength(3);
    expect(queries[0].params).toEqual(["agent-12345678-abcd", "%agent-12%"]);
    expect(queries[0].text).toContain("current_date");
    expect(queries[1].text).toContain("interval '7 days'");
    expect(queries[2].text).toContain("interval '30 days'");
  });

  it("returns a PostgreSQL-required message when the pool is null", async () => {
    const usage = registerWith(() => null)["lore_my_usage"];
    const result = await usage({});
    expect(result.content[0].text).toEqual(
      "Usage tracking requires PostgreSQL (LORE_DB_HOST not set).",
    );
  });

  it("returns an Error message when the query throws", async () => {
    const pool = {
      query: async () => {
        throw new Error("connection refused");
      },
    };
    const usage = registerWith(() => pool)["lore_my_usage"];
    const result = await usage({ agent_id: "agent-12345678-abcd" });
    expect(result.content[0].text).toEqual("Error: connection refused");
  });
});

describe("lore_get_analytics", () => {
  beforeEach(() => {
    process.env.LORE_DB_HOST = "localhost";
  });

  it("returns usage, task, and by_type analytics as JSON for the month period", async () => {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string) => {
        queries.push({ text });
        if (/FROM pipeline\.llm_calls/.test(text)) {
          return { rows: [{ calls: "12", input_tokens: "5000", output_tokens: "2500" }] };
        }
        if (/FILTER \(WHERE status = 'failed'\)/.test(text)) {
          return { rows: [{ total: "10", succeeded: "7", failed: "3" }] };
        }
        return { rows: [{ task_type: "implementation", tasks: "6" }, { task_type: "review", tasks: "4" }] };
      },
    };
    const analytics = registerWith(() => pool)["lore_get_analytics"];

    const result = await analytics({ period: "month" });

    expect(JSON.parse(result.content[0].text)).toEqual({
      period: "month",
      usage: { llm_calls: 12, input_tokens: 5000, output_tokens: 2500 },
      tasks: { total: 10, succeeded: 7, failed: 3 },
      by_type: [
        { task_type: "implementation", tasks: "6" },
        { task_type: "review", tasks: "4" },
      ],
    });
  });

  it("selects the today filter when period is today", async () => {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string) => {
        queries.push({ text });
        if (/FROM pipeline\.llm_calls/.test(text)) return { rows: [{ calls: "0", input_tokens: "0", output_tokens: "0" }] };
        if (/FILTER \(WHERE status = 'failed'\)/.test(text)) return { rows: [{ total: "0", succeeded: "0", failed: "0" }] };
        return { rows: [] };
      },
    };
    const analytics = registerWith(() => pool)["lore_get_analytics"];

    await analytics({ period: "today" });

    const usageQuery = queries.find((q) => /FROM pipeline\.llm_calls/.test(q.text));
    expect(usageQuery?.text).toContain("created_at > current_date");
  });

  it("returns a PostgreSQL-required message when LORE_DB_HOST is unset", async () => {
    delete process.env.LORE_DB_HOST;
    const analytics = registerWith(() => null)["lore_get_analytics"];
    const result = await analytics({ period: "month" });
    expect(result.content[0].text).toEqual(
      "Analytics requires PostgreSQL (LORE_DB_HOST not set).",
    );
  });

  it("returns an analytics Error message when a query throws", async () => {
    const pool = {
      query: async () => {
        throw new Error("relation does not exist");
      },
    };
    const analytics = registerWith(() => pool)["lore_get_analytics"];
    const result = await analytics({ period: "month" });
    expect(result.content[0].text).toEqual(
      "Error fetching analytics: relation does not exist",
    );
  });
});
