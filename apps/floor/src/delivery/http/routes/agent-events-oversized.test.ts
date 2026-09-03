import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { buildServer } from "../server.js";

const logLlmCall = vi.fn();
const insertBatch = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  clusterAgent: () => ({}),
  usage: () => ({ logLlmCall }),
  agentRunEvents: () => ({ insertBatch }),
}));

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;

const RESULT_LINE = JSON.stringify({
  source: { task: "task-uuid-1", agent: "cr-1" },
  event: {
    type: "result",
    subtype: "success",
    usage: { input_tokens: 3 },
    total_cost_usd: 0.01,
  },
});

const post = (payload: string) =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/agent-events",
    headers: { authorization: "Bearer internal-secret" },
    payload,
  });

beforeEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = "internal-secret";
  logLlmCall.mockReset().mockResolvedValue(undefined);
  insertBatch.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;

    return;
  }
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
});

describe("POST /api/agent-events oversized body", () => {
  it("records cost but skips the viz insert for an oversized body", async () => {
    const oversized = `${RESULT_LINE}\n${"x".repeat(9 * 1024 * 1024)}`;
    const res = await post(oversized);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect(logLlmCall).toHaveBeenCalledTimes(1);
    expect(insertBatch).not.toHaveBeenCalled();
  });
});
