import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const post = (body: unknown, pool: ReturnType<typeof makePool>) =>
  buildServer(() => pool as any).inject({ method: "POST", url: "/api/repos/o/r/ingest-graph", headers: AUTH, payload: JSON.stringify(body) });
const insertCalls = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO pipeline.events"));

/**
 * POST /api/repos/:owner/:repo/ingest-graph — the REST/curl/CI (re-)projection
 * trigger. Only docs (specs/adrs) project here: each inserts an
 * internal.ingest.spec_trace event on the Floor event bus (the loop projects).
 * Test projection is CI-only → rejected.
 */
describe("POST /api/repos/:owner/:repo/ingest-graph", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("inserts a spec-trace event for the specs kind and creates no task", async () => {
    const pool = makePool();
    const res = await post({ kinds: ["specs"], commit: "abc123" }, pool);
    expect(insertCalls(pool)[0]?.[1]?.[0]).toBe("internal.ingest.spec_trace");
    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ triggered: ["specs"] });
  });

  it("rejects the tests kind with 400 (test projection is CI-only)", async () => {
    const pool = makePool();
    const res = await post({ kinds: ["tests"] }, pool);
    expect(res.statusCode).toBe(400);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it("returns 400 on an unparseable body", async () => {
    const pool = makePool();
    const res = await buildServer(() => pool as any).inject({
      method: "POST",
      url: "/api/repos/o/r/ingest-graph",
      headers: AUTH,
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.result).toMatchObject({ error: "invalid_body" });
    expect(insertCalls(pool)).toHaveLength(0);
  });
});
