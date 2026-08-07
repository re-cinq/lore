import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const base = (headers: Record<string, string>) =>
  buildServer(() => makePool() as any).inject({
    method: "GET",
    url: "/api/repos/o/r/impact/base",
    headers,
  });

/**
 * GET /api/repos/:o/:r/impact/base — which commit the graph's line ranges are
 * expressed in. The Action reads this BEFORE computing its diff, so it can line
 * the two coordinate systems up instead of overlapping them blind.
 */
describe("GET /api/repos/:owner/:repo/impact/base", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns a null baseline rather than an error when Dgraph is not configured", async () => {
    const res = await base(AUTH);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ graphCommit: null, source: "none" });
  });

  it("rejects a request without a token", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    const res = await base({ authorization: "Bearer not-a-real-token" });

    expect(res.statusCode).toBe(403);
  });
});
