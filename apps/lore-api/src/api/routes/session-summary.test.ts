import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/memory/facts.js", () => ({ extractFactsFromEpisode: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@re-cinq/lore-server-core/features/memory/graph.js", () => ({ extractAndUpdateGraph: vi.fn() }));

import { extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function post(body: unknown, pool: any = makePool()) {
  const res = makeRes();
  return handleApiRoute(makeReq({ url: "/api/session-summary", method: "POST", headers: AUTH, body }), res, pool).then(() => res);
}

describe("POST /api/session-summary", () => {
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

  it("returns 400 when session_log is missing", async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the token lacks write scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/session-summary", method: "POST", headers: { authorization: "Bearer read-only" }, body: { session_log: "x" } }),
      res,
      pool as any,
    );
    expect(res.json).toEqual({ error: "insufficient scope" });
  });

  it("skips when the string summary is too short", async () => {
    const res = await post({ session_log: "hi" });
    expect(res.json).toEqual({ status: "skipped", reason: "empty session" });
  });

  it("uses the object .summary field", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 1 }] });
    const res = await post({ session_log: { summary: "a sufficiently long summary" }, repo: "o/r" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 1 });
  });

  it("falls back to JSON.stringify for objects without a summary", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 2 }] });
    const res = await post({ session_log: { detail: "enough content here" } }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 2 });
  });

  it("returns 503 when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/session-summary", method: "POST", headers: AUTH, body: { session_log: "a long enough session log" } }),
      res,
      null,
    );
    expect(res.statusCode).toBe(503);
  });

  it("returns duplicate when the insert conflicts", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = await post({ session_log: "a long enough session log" }, pool as any);
    expect(res.json).toEqual({ status: "duplicate" });
  });

  it("returns 500 when the insert throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db fail"));
    const res = await post({ session_log: "a long enough session log" }, pool as any);
    expect(res.statusCode).toBe(500);
  });

  it("swallows a failing session fact extraction", async () => {
    vi.mocked(extractFactsFromEpisode).mockRejectedValueOnce(new Error("facts fail"));
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 41 }] });
    const res = await post({ session_log: "another long enough session summary" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 41 });
    await new Promise((r) => setTimeout(r, 5));
  });

  it("runs and swallows graph extraction when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    globalThis.fetch = vi.fn() as typeof fetch;
    vi.mocked(extractAndUpdateGraph).mockRejectedValueOnce(new Error("graph fail"));
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 42 }] });
    const res = await post({ session_log: "a sufficiently long session summary" }, pool as any);
    expect(res.json).toEqual({ status: "ok", episode_id: 42 });
    await new Promise((r) => setTimeout(r, 5));
  });
});
