import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

vi.mock("../../features/spec-trace/ingest-graph-tasks.js", () => ({
  createIngestGraphTasks: vi.fn(),
}));

import { createIngestGraphTasks } from "../../features/spec-trace/ingest-graph-tasks.js";

const originalEnv = { ...process.env };

/**
 * POST /api/repos/:owner/:repo/ingest-graph — the REST/curl/CI trigger for
 * spec-traceability graph (re-)projection. Routes to createIngestGraphTasks
 * for the repo and returns its fan-out result as JSON.
 */
describe("POST /api/repos/:owner/:repo/ingest-graph", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("calls createIngestGraphTasks for o/r with force:true and returns its result as JSON", async () => {
    vi.mocked(createIngestGraphTasks).mockResolvedValue({
      groupId: "g1",
      created: [{ id: "t1", kind: "specs" }],
      skipped: [],
    });
    const res = makeRes();
    await handleApiRoute(
      makeReq({
        url: "/api/repos/o/r/ingest-graph",
        method: "POST",
        headers: AUTH,
        body: { kinds: ["specs"], force: true },
      }),
      res,
      makePool() as any,
    );
    expect(createIngestGraphTasks).toHaveBeenCalledWith(
      expect.anything(),
      "o/r",
      expect.objectContaining({ kinds: ["specs"], force: true }),
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(300);
    expect(res.json).toMatchObject({
      groupId: "g1",
      created: [{ id: "t1", kind: "specs" }],
    });
  });
});
