import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const impact = (body: unknown, headers: Record<string, string>) =>
  buildServer(() => makePool() as any).inject({
    method: "POST",
    url: "/api/repos/o/r/impact",
    headers,
    payload: JSON.stringify(body),
  });

/**
 * POST /api/repos/:o/:r/impact — the deterministic pre-merge spec-impact query.
 * With LORE_DGRAPH_HTTP unset (the shared-server default), the route fail-softs
 * to `status:"unavailable"` + 200 so the advisory Action skips cleanly.
 */
describe("POST /api/repos/:owner/:repo/impact", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 status unavailable with empty annotations when Dgraph is not configured", async () => {
    const res = await impact(
      { commit: "abc123", files: [{ path: "src/a.ts", ranges: [[1, 5]] }] },
      AUTH,
    );

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      status: "unavailable",
      statements: [],
      orphaned: [],
      annotations: [],
    });
  });

  it("rejects a request without a write-scoped token", async () => {
    delete process.env.LORE_INGEST_TOKEN;
    const res = await impact(
      { files: [] },
      { authorization: "Bearer not-a-real-token" },
    );

    expect(res.statusCode).toBe(403);
  });

  it("accepts a docs[] body carrying changed spec content without rejecting it", async () => {
    const res = await impact(
      {
        commit: "abc123",
        files: [],
        docs: [{ path: "specs/x/spec.md", content: "# X\n\nA MUST hold.\n" }],
      },
      AUTH,
    );

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ status: "unavailable" });
  });

  it("returns 400 on an unparseable body", async () => {
    // ADR-034: hapi parses the payload, so malformed JSON is a native 400.
    const res = await buildServer(() => makePool() as any).inject({
      method: "POST",
      url: "/api/repos/o/r/impact",
      headers: AUTH,
      payload: "{not json",
    });

    expect(res.statusCode).toBe(400);
  });
});
