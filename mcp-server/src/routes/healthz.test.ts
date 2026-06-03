import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "./helpers/http-mock.js";

vi.mock("../db.js", () => ({ getHealthStatus: vi.fn(), isDbAvailable: vi.fn(), getQueryEmbedding: vi.fn() }));

import { getHealthStatus } from "../db.js";

const originalEnv = { ...process.env };

describe("GET /healthz", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DB_HOST;
    vi.mocked(getHealthStatus).mockResolvedValue({ connected: true } as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 {status:ok} unauthenticated when connected", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz" }), res, null);
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ status: "ok" });
  });

  it("returns 503 {status:error} when disconnected and LORE_DB_HOST set", async () => {
    process.env.LORE_DB_HOST = "db.internal";
    vi.mocked(getHealthStatus).mockResolvedValue({ connected: false } as any);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz" }), res, null);
    expect(res.statusCode).toBe(503);
    expect(res.json).toEqual({ status: "error" });
  });

  it("returns 200 ok when disconnected but no LORE_DB_HOST configured", async () => {
    vi.mocked(getHealthStatus).mockResolvedValue({ connected: false } as any);
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz" }), res, null);
    expect(res.json).toEqual({ status: "ok" });
  });

  it("includes database + task stats when authenticated and connected", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ today: 3, pending: 2 }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz", headers: AUTH }), res, pool as any);
    expect(res.json).toMatchObject({
      status: "ok",
      database: { connected: true },
      tasks: { processed_today: 3, pending: 2 },
    });
  });

  it("falls back to zeroed task stats when the stats query throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("boom"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz", headers: AUTH }), res, pool as any);
    expect(res.json.tasks).toEqual({ processed_today: 0, pending: 0 });
  });

  it("skips the stats query when authed but pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz", headers: AUTH }), res, null);
    expect(res.json).toMatchObject({ tasks: { processed_today: 0, pending: 0 } });
  });

  it("zeroes task stats when the stats query returns no rows", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/healthz", headers: AUTH }), res, pool as any);
    expect(res.json.tasks).toEqual({ processed_today: 0, pending: 0 });
  });
});
