import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url = "/api/repo-status?repo=o/r") =>
  buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

// Native hapi route (Phase 3), driven through buildServer.inject with the legacy
// token (auth passes; the auth matrix itself lives in bearer-scope.test.ts).
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
    const res = await get(null);

    expect(res.result).toEqual({ onboarded: false });
  });

  it("returns onboarded:false when no repo param", async () => {
    const res = await get(makePool(), "/api/repo-status");

    expect(res.result).toEqual({ onboarded: false });
  });

  it("returns onboarded:false with repo when repo not in DB", async () => {
    const pool = makePool();

    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await get(pool);

    expect(res.result).toEqual({ onboarded: false, repo: "o/r" });
  });

  it("returns full stats with stale=false for a fresh repo", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [
          { settings: { auto_review: true }, last_ingested_at: new Date() },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ c: "1" }] })
      .mockResolvedValueOnce({ rows: [{ c: "2" }] })
      .mockResolvedValueOnce({ rows: [{ c: "5" }] });
    const res = await get(pool);

    expect(res.result).toMatchObject({
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
      .mockResolvedValueOnce({
        rows: [{ settings: {}, last_ingested_at: null }],
      })
      .mockResolvedValueOnce({ rows: [{ c: "0" }] })
      .mockResolvedValueOnce({ rows: [{ c: "0" }] })
      .mockResolvedValueOnce({ rows: [{ c: "0" }] });
    const res = await get(pool);

    expect(res.result).toMatchObject({
      onboarded: true,
      stale: true,
      auto_review: false,
    });
  });

  it("handles null settings and count rows missing", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ settings: null, last_ingested_at: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await get(pool);

    expect(res.result).toMatchObject({
      onboarded: true,
      running: 0,
      pr_ready: 0,
      memories: 0,
      auto_review: false,
    });
  });

  it("returns onboarded:false with error when a query throws", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("db gone"));
    const res = await get(pool);

    expect(res.result).toEqual({ onboarded: false, error: "db gone" });
  });

  it("returns 400 when repo is not owner/name", async () => {
    const res = await get(makePool(), "/api/repo-status?repo=notarepo");

    expect(res.statusCode).toBe(400);
  });
});
