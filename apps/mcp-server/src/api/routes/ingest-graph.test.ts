import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

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
    const res = makeRes();
    await handleApiRoute(
      makeReq({
        url: "/api/repos/o/r/ingest-graph",
        method: "POST",
        headers: AUTH,
        body: { kinds: ["specs"], commit: "abc123" },
      }),
      res,
      pool as any,
    );
    const insert = (pool.query as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO pipeline.events"),
    );
    expect(insert?.[1]?.[0]).toBe("internal.ingest.spec_trace");
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({ triggered: ["specs"] });
  });

  it("rejects the tests kind with 400 (test projection is CI-only)", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/ingest-graph", method: "POST", headers: AUTH, body: { kinds: ["tests"] } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(400);
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes("INSERT INTO pipeline.events"))).toBe(false);
  });
});
