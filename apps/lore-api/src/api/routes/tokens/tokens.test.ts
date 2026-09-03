import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

function serializedPayload(requestBody: unknown): string | undefined {
  if (requestBody === undefined) {
    return undefined;
  }

  return typeof requestBody === "string"
    ? requestBody
    : JSON.stringify(requestBody);
}

function req(
  opts: { method: "GET" | "POST" | "PUT"; body?: unknown; query?: string },
  pool: unknown = makePool(),
) {
  const payload = serializedPayload(opts.body);

  return buildServer(() => pool as any).inject({
    method: opts.method,
    url: "/api/tokens" + (opts.query ?? ""),
    headers: AUTH,
    payload,
  });
}

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
    const res = await req({ method: "GET" }, null);

    expect(res.statusCode).toBe(503);
  });

  it("lists active tokens on GET with paging metadata", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: "ci" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const res = await req({ method: "GET" }, pool);

    expect(res.result).toEqual({
      tokens: [{ id: 1, name: "ci" }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(pool.query.mock.calls[0][1]).toEqual([20, 0]);
  });

  it("clamps over-max limit and applies offset on GET", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await req({ method: "GET", query: "?limit=999&offset=5" }, pool);
    expect(pool.query.mock.calls[0][1]).toEqual([100, 5]);
  });

  it("returns 400 for a negative offset on GET", async () => {
    const res = await req({ method: "GET", query: "?offset=-1" }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("revokes a token on POST", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({});
    const res = await req(
      { method: "POST", body: { action: "revoke", token_id: "x" } },
      pool,
    );

    expect(res.result).toEqual({ ok: true });
  });

  it("returns 400 when creating without a name", async () => {
    const res = await req({ method: "POST", body: {} }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("creates a token, filtering invalid scopes and computing expiry", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ id: 9, name: "ci", scopes: ["read"], created_at: "now" }],
    });
    const res = await req(
      {
        method: "POST",
        body: { name: "ci", scopes: ["read", "bogus"], expires_in_days: 30 },
      },
      pool,
    );

    expect(res.statusCode).toBe(201);
    const body = res.result as { token: string; expires_at: string | null };

    expect(body.token).toMatch(/^lore_[0-9a-f]{64}$/);
    expect(body.expires_at).not.toBeNull();
  });

  it("creates a token with default scope and no expiry", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: 10, name: "ci" }] });
    const res = await req({ method: "POST", body: { name: "ci" } }, pool);

    expect((res.result as { expires_at: string | null }).expires_at).toBeNull();
  });

  it("returns 500 when the insert throws", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("insert fail"));
    const res = await req({ method: "POST", body: { name: "ci" } }, pool);

    expect(res.statusCode).toBe(500);
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await req({ method: "PUT", body: {} }, makePool());

    expect(res.statusCode).toBe(405);
  });
});
