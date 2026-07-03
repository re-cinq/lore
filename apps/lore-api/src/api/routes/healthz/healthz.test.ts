import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/platform/db.js", () => ({ getHealthStatus: vi.fn(), isDbAvailable: vi.fn(), getQueryEmbedding: vi.fn() }));

import { getHealthStatus } from "@re-cinq/lore-server-core/platform/db.js";

const originalEnv = { ...process.env };
const inject = (pool: unknown, headers?: Record<string, string>) =>
  buildServer(() => pool as any).inject({ method: "GET", url: "/healthz", headers });

// /healthz is a native hapi route (Phase 2), driven through buildServer. The
// handler keeps its own bearer check so authenticated callers get db + task
// stats; the route itself stays public (auth: false).
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
    const res = await inject(null);
    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ status: "ok" });
  });

  it("returns 503 {status:error} when disconnected and LORE_DB_HOST set", async () => {
    process.env.LORE_DB_HOST = "db.internal";
    vi.mocked(getHealthStatus).mockResolvedValue({ connected: false } as any);
    const res = await inject(null);
    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ status: "error" });
  });

  it("returns 200 ok when disconnected but no LORE_DB_HOST configured", async () => {
    vi.mocked(getHealthStatus).mockResolvedValue({ connected: false } as any);
    const res = await inject(null);
    expect(res.result).toEqual({ status: "ok" });
  });

  it("includes database + task stats when authenticated and connected", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ today: 3, pending: 2 }] });
    const res = await inject(pool, AUTH);
    expect(res.result).toMatchObject({
      status: "ok",
      database: { connected: true },
      tasks: { processed_today: 3, pending: 2 },
    });
  });

  it("falls back to zeroed task stats when the stats query throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("boom"));
    const res = await inject(pool, AUTH);
    expect((res.result as any).tasks).toEqual({ processed_today: 0, pending: 0 });
  });

  it("skips the stats query when authed but pool is null", async () => {
    const res = await inject(null, AUTH);
    expect(res.result).toMatchObject({ tasks: { processed_today: 0, pending: 0 } });
  });

  it("zeroes task stats when the stats query returns no rows", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = await inject(pool, AUTH);
    expect((res.result as any).tasks).toEqual({ processed_today: 0, pending: 0 });
  });
});
