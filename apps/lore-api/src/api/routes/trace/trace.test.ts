import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (url: string, headers?: Record<string, string>) =>
  buildServer(() => makePool() as any).inject({ method: "GET", url, headers });

/**
 * GET /api/repos/:o/:r/trace/{kind} and GET /api/trace/specs — the read routes.
 * With LORE_DGRAPH_HTTP unset the global viewer fails soft to an empty list, and
 * the per-repo route's pre-graph validation (404 unknown kind) is reachable.
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
    const res = await get("/api/repos/o/r/trace/bogus", AUTH);
    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "not found" });
  });

  it("returns 401 without a bearer token", async () => {
    const res = await get("/api/repos/o/r/trace/specs");
    expect(res.statusCode).toBe(401);
  });

  it("passes read-scope auth for a matched kind (no 401/403 gate hit)", async () => {
    const res = await get("/api/repos/o/r/trace/bogus", AUTH);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 400 when the path query exceeds the length bound", async () => {
    const res = await get(
      `/api/repos/o/r/trace/document?path=${"x".repeat(1025)}`,
      AUTH,
    );
    expect(res.statusCode).toBe(400);
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
    const res = await get("/api/trace/specs", AUTH);
    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ specs: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const res = await get("/api/trace/specs");
    expect(res.statusCode).toBe(401);
  });
});
