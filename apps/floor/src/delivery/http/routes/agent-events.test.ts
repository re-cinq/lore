import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";
import { buildServer } from "../server.js";
import { agentEventBus } from "../../../jobs/agent/agent-event-bus.js";

const logLlmCall = vi.fn();
const insertBatch = vi.fn();
const write = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  // The logs route resolves the cluster agent from here.
  clusterAgent: () => ({}),
  usage: () => ({ logLlmCall }),
  pipeline: () => ({
    agentRunEvents: { insertBatch },
    audit: { write },
  }),
}));

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;

const insertedRow = (assemblyLineId: string | null): AgentRunEventRow => ({
  id: "1",
  taskId: "task-uuid-1",
  agentCrName: "cr-1",
  assemblyLineId,
  stationRunId: null,
  nodeId: "review",
  iteration: 1,
  eventType: "result",
  toolName: null,
  toolUseId: null,
  isError: false,
  filePaths: [],
  summary: null,
  payload: {},
  createdAt: new Date(0),
});

const RESULT_LINE = JSON.stringify({
  source: { task: "task-uuid-1", agent: "cr-1" },
  event: {
    type: "result",
    subtype: "success",
    model: "claude-opus-4",
    usage: { input_tokens: 3, output_tokens: 1 },
    total_cost_usd: 0.01,
    duration_ms: 10,
  },
});

const post = (payload: string) =>
  buildServer({ getJobStatus: () => ({}) }).inject({
    method: "POST",
    url: "/api/agent-events",
    headers: { authorization: "Bearer internal-secret" },
    payload,
  });

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;
  } else {
    process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
  }
});

describe("POST /api/agent-events", () => {
  it("returns 401 when the bearer token does not match", async () => {
    process.env.LORE_AGENT_INTERNAL_TOKEN = "internal-secret";
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/agent-events",
      headers: { authorization: "Bearer wrong" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when the internal token is not configured", async () => {
    delete process.env.LORE_AGENT_INTERNAL_TOKEN;
    const res = await buildServer({ getJobStatus: () => ({}) }).inject({
      method: "POST",
      url: "/api/agent-events",
      headers: { authorization: "Bearer anything" },
      payload: "{}",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/agent-events persistence", () => {
  beforeEach(() => {
    process.env.LORE_AGENT_INTERNAL_TOKEN = "internal-secret";
    logLlmCall.mockReset().mockResolvedValue({ correlated: true });
    insertBatch.mockReset().mockResolvedValue([insertedRow("line-a")]);
    write.mockReset().mockResolvedValue(undefined);
  });

  it("returns 200 with recorded counts and publishes the inserted rows after the insert resolves", async () => {
    const seen: AgentRunEventRow[][] = [];
    const unsubscribe = agentEventBus().subscribe("line-a", (rows) =>
      seen.push(rows),
    );
    const res = await post(RESULT_LINE);

    unsubscribe();

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([[insertedRow("line-a")]]);
  });

  it("publishes nothing to a line the inserted rows do not belong to", async () => {
    const handler = vi.fn();
    const unsubscribe = agentEventBus().subscribe("line-b", handler);

    await post(RESULT_LINE);
    unsubscribe();

    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the unchanged cost-path response when insertBatch rejects", async () => {
    insertBatch.mockRejectedValue(new Error("pg down"));
    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
  });

  it("publishes nothing when insertBatch rejects", async () => {
    insertBatch.mockRejectedValue(new Error("pg down"));
    const handler = vi.fn();
    const unsubscribe = agentEventBus().subscribe("line-a", handler);

    await post(RESULT_LINE);
    unsubscribe();

    expect(handler).not.toHaveBeenCalled();
  });

  it("writes a cost-degraded audit row when a cost row is uncorrelated", async () => {
    logLlmCall.mockResolvedValue({ correlated: false });

    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      event_type: "agent_events_cost_degraded",
      task_id: "task-uuid-1",
      payload: { recorded: 1, uncorrelated: 1, failed: 0 },
    });
  });

  it("writes a cost-degraded audit row when a cost insert throws", async () => {
    logLlmCall.mockRejectedValue(new Error("pg down"));

    const res = await post(RESULT_LINE);

    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 0 });
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      event_type: "agent_events_cost_degraded",
      payload: { recorded: 0, uncorrelated: 0, failed: 1 },
    });
  });

  it("writes no audit row when every cost row correlates", async () => {
    const res = await post(RESULT_LINE);

    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect(write).not.toHaveBeenCalled();
  });

  it("does not 500 when the audit write throws", async () => {
    logLlmCall.mockResolvedValue({ correlated: false });
    write.mockRejectedValue(new Error("audit db down"));

    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
  });
});
