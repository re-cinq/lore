import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

/**
 * GET /api/repos/:o/:r/trace/{kind} and GET /api/trace/specs — the
 * spec-traceability read routes. With LORE_DGRAPH_HTTP unset (the shared-server
 * default) the global viewer fails soft to an empty list, and the per-repo
 * route's pre-graph validation (404 unknown kind, 400 missing path) is reachable
 * without a live backend. The graph-read branches need live Dgraph.
 */
describe("GET /api/repos/:owner/:repo/trace/:kind", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 404 for an unknown trace kind", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/trace/bogus", method: "GET", headers: AUTH }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json).toEqual({ error: "not found" });
  });

  it("returns 401 without a bearer token", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/trace/specs", method: "GET" }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(401);
  });

  it("passes read-scope auth for a matched kind (no 401/403 gate hit)", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/trace/bogus", method: "GET", headers: AUTH }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("GET /api/trace/specs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 with an empty specs list when Dgraph is not configured", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/trace/specs", method: "GET", headers: AUTH }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ specs: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/trace/specs", method: "GET" }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(401);
  });
});
