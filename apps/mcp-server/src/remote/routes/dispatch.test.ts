import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import {
  makeReq,
  makeRes,
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "../../test-helpers/http-mock.js";

// handleHealthz is the only dispatch-reachable handler here that touches a
// collaborator module; everything else short-circuits on pool/secret guards.
vi.mock("../../platform/db.js", () => ({
  getHealthStatus: vi.fn().mockResolvedValue({ connected: true }),
  isDbAvailable: vi.fn(),
  getQueryEmbedding: vi.fn(),
}));

const originalEnv = { ...process.env };

describe("handleApiRoute dispatch — rate limiting", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 429 on the 201st default-bucket request in one window", async () => {
    let last = makeRes();
    for (let i = 0; i < 201; i++) {
      last = makeRes();
      await handleApiRoute(
        makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }),
        last,
        null,
      );
    }
    expect(last.statusCode).toBe(429);
    expect(last.json).toEqual({ error: "rate limit exceeded" });
    expect(last.headers["Retry-After"]).toBe("60");
  });

  it("returns 429 on the 61st task-bucket request", async () => {
    let last = makeRes();
    for (let i = 0; i < 61; i++) {
      last = makeRes();
      await handleApiRoute(
        makeReq({ url: "/api/task", method: "POST", headers: AUTH, body: {} }),
        last,
        null,
      );
    }
    expect(last.statusCode).toBe(429);
  });

  it("returns 429 on the 31st webhook-bucket request", async () => {
    let last = makeRes();
    for (let i = 0; i < 31; i++) {
      last = makeRes();
      await handleApiRoute(
        makeReq({ url: "/api/webhook/github", method: "POST", body: {} }),
        last,
        null,
      );
    }
    expect(last.statusCode).toBe(429);
  });
});

describe("handleApiRoute dispatch — auth", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 401 when no bearer token on a protected route", async () => {
    const res = makeRes();
    const handled = await handleApiRoute(
      makeReq({ url: "/api/repo-status?repo=o/r" }),
      res,
      null,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.json).toEqual({ error: "unauthorized" });
  });

  it("returns 403 when bearer is not the legacy token and pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/foo", headers: { authorization: "Bearer wrong" } }),
      res,
      null,
    );
    expect(res.statusCode).toBe(403);
    expect(res.json).toEqual({ error: "insufficient scope" });
  });

  it("returns 403 when the DB has no matching token", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/foo", headers: { authorization: "Bearer db-x" } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(403);
  });

  it("passes (route not handled) when the DB token carries the required scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = makeRes();
    const handled = await handleApiRoute(
      makeReq({ url: "/api/foo", headers: { authorization: "Bearer db-read" } }),
      res,
      pool as any,
    );
    expect(handled).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("grants any scope when the DB token has admin scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["admin"] }] });
    const res = makeRes();
    const handled = await handleApiRoute(
      makeReq({ url: "/api/onboard", method: "POST", headers: { authorization: "Bearer db-admin" }, body: {} }),
      res,
      pool as any,
    );
    // admin passes auth; handleOnboard then 400s on the empty body — the point
    // is auth did not 403.
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when the DB token lacks the admin scope an admin route needs", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/onboard", method: "POST", headers: { authorization: "Bearer db-read" }, body: {} }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when the token lookup query throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db down"));
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/foo", headers: { authorization: "Bearer db-x" } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(403);
  });

  it("grants access via the legacy token without hitting the DB", async () => {
    const pool = makePool();
    const res = makeRes();
    const handled = await handleApiRoute(
      makeReq({ url: "/api/foo", headers: AUTH }),
      res,
      pool as any,
    );
    expect(handled).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("applies the dark-factory admin scope override (403 for a read token)", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/settings/dark-factory", headers: { authorization: "Bearer db-read" } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(403);
  });

  it("returns false for an unknown route after auth passes", async () => {
    const res = makeRes();
    const handled = await handleApiRoute(
      makeReq({ url: "/api/nope", headers: AUTH }),
      res,
      null,
    );
    expect(handled).toBe(false);
    expect(res.ended).toBe(false);
  });

  it("tolerates an empty url and method", async () => {
    const res = makeRes();
    const handled = await handleApiRoute(
      makeReq({ url: "", method: "", headers: AUTH }),
      res,
      null,
    );
    expect(handled).toBe(false);
  });
});
