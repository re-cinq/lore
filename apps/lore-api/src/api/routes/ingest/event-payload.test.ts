import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const get = (id: string, pool: ReturnType<typeof makePool>) =>
  buildServer(() => pool as any).inject({
    method: "GET",
    url: `/api/repos/o/r/events/${id}/payload`,
    headers: AUTH,
  });

/**
 * GET /api/repos/:owner/:repo/events/:id/payload — the ingest station's
 * payload-by-reference fetch (specs/ingest-station FR3): a test-report body is
 * ~1 MB and cannot ride station_input argv, so the pod reads it back from the
 * pipeline.events row that scheduled it. Read scope; repo must match the row.
 */
describe("GET /api/repos/:owner/:repo/events/:id/payload", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the event's payload for a matching repo", async () => {
    const pool = makePool();

    pool.query.mockResolvedValueOnce({
      rows: [{ payload: { tests: [{ id: "t1" }] }, repo: "o/r" }],
    });
    const res = await get("4711", pool);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ tests: [{ id: "t1" }] });
    expect(pool.query.mock.calls[0][1]).toEqual(["4711"]);
  });

  it("404s when the row belongs to another repo", async () => {
    const pool = makePool();

    pool.query.mockResolvedValueOnce({
      rows: [{ payload: { tests: [] }, repo: "someone/else" }],
    });

    expect((await get("4711", pool)).statusCode).toBe(404);
  });

  it("404s when the event does not exist or carries no payload", async () => {
    const pool = makePool();

    pool.query.mockResolvedValueOnce({ rows: [] });

    expect((await get("999", pool)).statusCode).toBe(404);
  });
});
