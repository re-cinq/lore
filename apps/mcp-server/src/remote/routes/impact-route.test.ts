import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

/**
 * POST /api/repos/:o/:r/impact — the deterministic pre-merge spec-impact query.
 * With LORE_DGRAPH_HTTP unset (the shared-server default), the route must
 * fail-soft to `status:"unavailable"` + `200` so the advisory Action skips
 * cleanly rather than red-Xing the PR.
 */
describe("POST /api/repos/:owner/:repo/impact", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 status unavailable with empty annotations when Dgraph is not configured", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({
        url: "/api/repos/o/r/impact",
        method: "POST",
        headers: AUTH,
        body: { commit: "abc123", files: [{ path: "src/a.ts", ranges: [[1, 5]] }] },
      }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({
      status: "unavailable",
      statements: [],
      orphaned: [],
      annotations: [],
    });
  });

  it("rejects a request without a write-scoped token", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    const res = makeRes();
    await handleApiRoute(
      makeReq({
        url: "/api/repos/o/r/impact",
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token" },
        body: { files: [] },
      }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(403);
  });
});
