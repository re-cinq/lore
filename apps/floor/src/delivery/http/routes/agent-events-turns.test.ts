// The turn-store tee on POST /api/agent-events (specs/turn-level-transcript-store
// FR3). A separate file from agent-events.test.ts because that one carries #L
// anchors from specs/assembly-line-run-viz and its module mock would have to be
// widened in place, shifting every anchor below it.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { buildServer } from "../server.js";

const logLlmCall = vi.fn();
const insertBatch = vi.fn();
const insertTurns = vi.fn();
const write = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  // The logs route resolves the cluster agent from here.
  clusterAgent: () => ({}),
  usage: () => ({ logLlmCall }),
  pipeline: () => ({
    agentRunEvents: { insertBatch },
    agentRunTurns: { insertBatch: insertTurns },
    audit: { write },
  }),
}));

const ORIG_TOKEN = process.env.LORE_AGENT_INTERNAL_TOKEN;

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
  logLlmCall.mockReset().mockResolvedValue({ correlated: true });
  insertBatch.mockReset().mockResolvedValue([]);
  insertTurns.mockReset().mockResolvedValue([{ id: "1" }]);
  write.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG_TOKEN ?? "";
  vi.restoreAllMocks();
});

describe("POST /api/agent-events turn store", () => {
  it("writes one untruncated turn per line, with nothing to switch it on", async () => {
    await post(RESULT_LINE);

    expect(insertTurns).toHaveBeenCalledTimes(1);
    expect(insertTurns.mock.calls[0][0]).toEqual([
      {
        taskId: "task-uuid-1",
        agentCrName: "cr-1",
        carried: null,
        eventType: "result",
        envelope: RESULT_LINE,
        dedupKey: null,
      },
    ]);
  });

  it("records the same cost row and viz row it would without the turn store", async () => {
    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect(logLlmCall).toHaveBeenCalledTimes(1);
    expect(insertBatch).toHaveBeenCalledTimes(1);
  });

  it("returns the unchanged cost-path response when the turn insert rejects", async () => {
    insertTurns.mockRejectedValue(new Error("pg down"));

    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok", events: 1, recorded: 1 });
    expect(logLlmCall).toHaveBeenCalledTimes(1);
  });

  it("writes no turn for an oversized body, the only gate left", async () => {
    const oversized = `${RESULT_LINE}\n${"x".repeat(9 * 1024 * 1024)}`;

    const res = await post(oversized);

    expect(res.statusCode).toBe(200);
    expect(logLlmCall).toHaveBeenCalledTimes(1);
    expect(insertTurns).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent-events dropped-turn signal", () => {
  const BREAKING_LINE = JSON.stringify({
    source: { task: "task-uuid-1", agent: "cr-1" },
    event: {
      type: "assistant",
      "-----BEGIN PRIVATE KEY-----k": 1,
      z: "-----END PRIVATE KEY-----",
    },
  });

  it("warns with a count when redaction drops turns, and still records cost", async () => {
    // Re-spying an already-spied method hands back the SAME mock, calls and
    // all, so clear rather than trust a fresh spy.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warn.mockClear();

    const res = await post(`${BREAKING_LINE}\n${RESULT_LINE}`);

    expect(res.statusCode).toBe(200);
    expect(logLlmCall).toHaveBeenCalledTimes(1);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("1 turn(s) dropped"),
      ),
    ).toBe(true);
  });

  it("warns about nothing when every line survives redaction", async () => {
    // Re-spying an already-spied method hands back the SAME mock, calls and
    // all, so clear rather than trust a fresh spy.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warn.mockClear();

    await post(RESULT_LINE);

    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("dropped")),
    ).toBe(false);
  });

  it("warns with a count when the per-batch cap leaves turns out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warn.mockClear();
    const overCap = Array.from({ length: 10_003 }, () =>
      JSON.stringify({
        source: { task: "task-uuid-1", agent: "cr-1" },
        event: { type: "assistant", message: { content: [] } },
      }),
    ).join("\n");

    await post(overCap);

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("3 turn(s) dropped"),
      ),
    ).toBe(true);
  });
});

describe("POST /api/agent-events deduped-turn signal (#1389)", () => {
  it("warns with a count when the store skips already-ingested duplicates", async () => {
    insertTurns.mockResolvedValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await post(RESULT_LINE);

    expect(res.statusCode).toBe(200);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("1 turn(s) skipped as already-stored"),
      ),
    ).toBe(true);
  });

  it("warns about no duplicates when every row inserts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warn.mockClear();

    await post(RESULT_LINE);

    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("already-stored"),
      ),
    ).toBe(false);
  });
});
