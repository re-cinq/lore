import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { registerBearerScope, bearerScope } from "./bearer-scope.js";
import { makePool, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

// The auth matrix for native routes, proven against the scheme via throwaway
// routes: a MISSING bearer → 401 {error:unauthorized}; any present-but-invalid
// or under-scoped token → 403 {error:insufficient scope}; admin / legacy token
// grant everything. Bodies match the legacy dispatcher byte-for-byte (SC-3).
function server(pool: unknown): Hapi.Server {
  const s = Hapi.server();
  registerBearerScope(s, () => pool as any);
  s.route({ method: "GET", path: "/guarded", options: bearerScope("read"), handler: () => ({ ok: true }) });
  s.route({ method: "GET", path: "/admin-only", options: bearerScope("admin"), handler: () => ({ ok: true }) });
  return s;
}

describe("bearer-scope auth scheme", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 401 {error:unauthorized} when no bearer token", async () => {
    const res = await server(null).inject({ method: "GET", url: "/guarded" });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toEqual({ error: "unauthorized" });
  });

  it("returns 403 {error:insufficient scope} when the token is not legacy and pool is null", async () => {
    const res = await server(null).inject({ method: "GET", url: "/guarded", headers: { authorization: "Bearer wrong" } });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toEqual({ error: "insufficient scope" });
  });

  it("returns 403 when the DB has no matching token", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = await server(pool).inject({ method: "GET", url: "/guarded", headers: { authorization: "Bearer db-x" } });
    expect(res.statusCode).toBe(403);
  });

  it("passes when the DB token carries the required scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = await server(pool).inject({ method: "GET", url: "/guarded", headers: { authorization: "Bearer db-read" } });
    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("grants any scope when the DB token has admin", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["admin"] }] });
    const res = await server(pool).inject({ method: "GET", url: "/admin-only", headers: { authorization: "Bearer db-admin" } });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 when the DB token lacks the scope the route needs", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    const res = await server(pool).inject({ method: "GET", url: "/admin-only", headers: { authorization: "Bearer db-read" } });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when the token lookup query throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db down"));
    const res = await server(pool).inject({ method: "GET", url: "/guarded", headers: { authorization: "Bearer db-x" } });
    expect(res.statusCode).toBe(403);
  });

  it("grants access via the legacy token without hitting the DB", async () => {
    const pool = makePool();
    const res = await server(pool).inject({ method: "GET", url: "/admin-only", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
