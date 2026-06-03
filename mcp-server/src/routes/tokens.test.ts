import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("/api/tokens", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", headers: AUTH }), res, null);
    expect(res.statusCode).toBe(503);
  });
  it("lists active tokens on GET", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 1, name: "ci" }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ tokens: [{ id: 1, name: "ci" }] });
  });
  it("revokes a token on POST", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({});
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "POST", headers: AUTH, body: { action: "revoke", token_id: "x" } }), res, pool as any);
    expect(res.json).toEqual({ ok: true });
  });
  it("returns 400 when creating without a name", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "POST", headers: AUTH, body: {} }), res, pool as any);
    expect(res.statusCode).toBe(400);
  });
  it("creates a token, filtering invalid scopes and computing expiry", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 9, name: "ci", scopes: ["read"], created_at: "now" }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "POST", headers: AUTH, body: { name: "ci", scopes: ["read", "bogus"], expires_in_days: 30 } }), res, pool as any);
    expect(res.statusCode).toBe(201);
    expect(res.json.token).toMatch(/^lore_[0-9a-f]{64}$/);
    expect(res.json.expires_at).not.toBeNull();
  });
  it("creates a token with default scope and no expiry", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ id: 10, name: "ci" }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "POST", headers: AUTH, body: { name: "ci" } }), res, pool as any);
    expect(res.json.expires_at).toBeNull();
  });
  it("returns 500 when the insert throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("insert fail"));
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "POST", headers: AUTH, body: { name: "ci" } }), res, pool as any);
    expect(res.statusCode).toBe(500);
  });
  it("returns 405 for unsupported methods", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "PUT", headers: AUTH, body: {} }), res, pool as any);
    expect(res.statusCode).toBe(405);
  });
  it("returns 405 when the method is absent", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/tokens", method: "", headers: AUTH }), res, pool as any);
    expect(res.statusCode).toBe(405);
  });
});
