import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

vi.mock("../../features/memory/facts.js", () => ({ extractFactsFromEpisode: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../features/memory/graph.js", () => ({ extractAndUpdateGraph: vi.fn() }));
vi.mock("@re-cinq/lore-shared", () => ({
  redactSecrets: (s: string) => s,
  parseTasks: vi.fn(),
  inferPhaseDependencies: vi.fn(),
  parseTrailers: vi.fn(),
  parseSpecTitle: vi.fn(),
  extractSummary: vi.fn(),
  reassembleSpec: vi.fn(),
  // The graph closure routes through Llm.instance now; provider-internal cost
  // logging is tested in shared, so a tiny fake suffices here.
  Llm: { instance: { complete: vi.fn().mockResolvedValue({ text: "ok" }) } },
}));

import { extractFactsFromEpisode } from "../../features/memory/facts.js";
import { extractAndUpdateGraph } from "../../features/memory/graph.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function post(body: unknown, pool: any = makePool()) {
  const res = makeRes();
  return handleApiRoute(makeReq({ url: "/api/episode", method: "POST", headers: AUTH, body }), res, pool).then(() => res);
}

describe("POST /api/episode", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns 400 when content is missing", async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the token lacks write scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/episode", method: "POST", headers: { authorization: "Bearer read-only" }, body: { content: "x" } }),
      res,
      pool as any,
    );
    expect(res.json).toEqual({ error: "insufficient scope" });
  });

  it("returns duplicate when the insert conflicts", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = await post({ content: "hello" }, pool as any);
    expect(res.json).toEqual({ status: "duplicate" });
  });

  it("stores a new episode and runs the graph LLM closure when key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    let closureRan = false;
    vi.mocked(extractAndUpdateGraph).mockImplementation(async (...args: any[]) => {
      const llm = args[5];
      if (llm) {
        await llm("prompt");
        closureRan = true;
      }
    });
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 99 }] });
    const res = await post({ content: "a new observation", agent_id: "a1" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 99 });
    expect(extractFactsFromEpisode).toHaveBeenCalled();
    await vi.waitFor(() => expect(closureRan).toBe(true));
  });

  it("skips graph extraction when ANTHROPIC_API_KEY is unset", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 5 }] });
    const res = await post({ content: "another observation" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 5 });
    expect(extractAndUpdateGraph).not.toHaveBeenCalled();
  });

  it("returns 500 when the episode insert throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("insert fail"));
    const res = await post({ content: "boom" }, pool as any);
    expect(res.statusCode).toBe(500);
  });

  it("swallows a failing fact extraction", async () => {
    vi.mocked(extractFactsFromEpisode).mockRejectedValueOnce(new Error("facts fail"));
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 11 }] });
    const res = await post({ content: "obs for facts reject" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 11 });
    await new Promise((r) => setTimeout(r, 5));
  });

  it("swallows a failing graph update", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    globalThis.fetch = vi.fn() as typeof fetch;
    vi.mocked(extractAndUpdateGraph).mockRejectedValueOnce(new Error("graph fail"));
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 12 }] });
    const res = await post({ content: "obs for graph reject" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 12 });
    await new Promise((r) => setTimeout(r, 5));
  });
});
