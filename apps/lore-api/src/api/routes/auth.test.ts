import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { makePool, useRateLimitSafeClock } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { rateLimit, resolveTokenScopes, validateClientToken } from "./auth.js";

const originalEnv = { ...process.env };
const ALL_SCOPES = ["read", "write", "task", "webhook", "admin"];
const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

describe("rateLimit", () => {
  // The sliding window is module state; the safe clock jumps 120s between tests
  // so a prior test's 60s window is fully evicted on this test's first call.
  useRateLimitSafeClock();

  it("allows requests up to the bucket limit then blocks the next", () => {
    for (let i = 0; i < 30; i++) expect(rateLimit("webhook")).toBe(true);
    expect(rateLimit("webhook")).toBe(false);
  });

  it("allows requests again once the 60s window slides past", () => {
    for (let i = 0; i < 30; i++) rateLimit("webhook");
    expect(rateLimit("webhook")).toBe(false);
    vi.setSystemTime(Date.now() + 61_000);
    expect(rateLimit("webhook")).toBe(true);
  });
});

describe("resolveTokenScopes", () => {
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = "legacy-full-access";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("resolves the legacy ingest token to all scopes without a DB hit", async () => {
    const pool = makePool();
    expect(await resolveTokenScopes(pool as never, "legacy-full-access")).toEqual(ALL_SCOPES);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns null for a non-legacy token when the pool is null", async () => {
    expect(await resolveTokenScopes(null, "other")).toBeNull();
  });

  it("returns the token's scopes on a DB hit, looked up by sha256 hash", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read", "write"] }] });
    expect(await resolveTokenScopes(pool as never, "client-token")).toEqual(["read", "write"]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("pipeline.api_tokens"), [sha256("client-token")]);
  });

  it("returns null when the token matches no active row", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    expect(await resolveTokenScopes(pool as never, "revoked")).toBeNull();
  });

  it("returns null when the DB lookup throws", async () => {
    const pool = makePool();
    pool.query.mockRejectedValue(new Error("db down"));
    expect(await resolveTokenScopes(pool as never, "client-token")).toBeNull();
  });
});

describe("validateClientToken", () => {
  beforeEach(() => {
    delete process.env.LORE_INGEST_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("grants access when the token carries the required scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read", "write"] }] });
    expect(await validateClientToken(pool as never, "t", "write")).toBe(true);
  });

  it("grants access to any scope when the token has admin", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["admin"] }] });
    expect(await validateClientToken(pool as never, "t", "webhook")).toBe(true);
  });

  it("denies access when the token lacks the required scope", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ scopes: ["read"] }] });
    expect(await validateClientToken(pool as never, "t", "write")).toBe(false);
  });

  it("denies access when the token resolves to no scopes", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    expect(await validateClientToken(pool as never, "unknown", "read")).toBe(false);
  });
});
