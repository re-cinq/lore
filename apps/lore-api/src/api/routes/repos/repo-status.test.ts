import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("GET /api/repo-status", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns onboarded:false when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }), res, null);
    expect(res.json).toEqual({ onboarded: false });
  });

  it("returns onboarded:false when no repo param", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ onboarded: false });
  });

  it("returns onboarded:false with repo when repo not in DB", async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ onboarded: false, repo: "o/r" });
  });

  it("returns full stats with stale=false for a fresh repo", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ settings: { auto_review: true }, last_ingested_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ c: "1" }] })
      .mockResolvedValueOnce({ rows: [{ c: "2" }] })
      .mockResolvedValueOnce({ rows: [{ c: "5" }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({
      onboarded: true,
      repo: "o/r",
      running: 1,
      pr_ready: 2,
      memories: 5,
      auto_review: true,
      stale: false,
    });
  });

  it("marks stale=true when last_ingested_at is null", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ settings: {}, last_ingested_at: null }] })
      .mockResolvedValueOnce({ rows: [{ c: "0" }] })
      .mockResolvedValueOnce({ rows: [{ c: "0" }] })
      .mockResolvedValueOnce({ rows: [{ c: "0" }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({ onboarded: true, stale: true, auto_review: false });
  });

  it("handles null settings and count rows missing", async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ settings: null, last_ingested_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({ onboarded: true, running: 0, pr_ready: 0, memories: 0, auto_review: false });
  });

  it("returns onboarded:false with error when a query throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db gone"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/repo-status?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ onboarded: false, error: "db gone" });
  });
});
