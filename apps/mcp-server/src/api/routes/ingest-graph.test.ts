import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

vi.mock("../../features/spec-trace/ingest-graph-tasks.js", () => ({
  createIngestGraphTasks: vi.fn(),
}));

import { createIngestGraphTasks } from "../../features/spec-trace/ingest-graph-tasks.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

/**
 * POST /api/repos/:owner/:repo/ingest-graph — the REST/curl/CI (re-)projection
 * trigger. Docs (specs/adrs) fire the fire-and-forget spec-trace trigger — no
 * task. Tests keep the pipeline-task path (they run the suite locally / in CI).
 */
describe("POST /api/repos/:owner/:repo/ingest-graph", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("fires the spec-trace trigger for the specs kind and creates no task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const res = makeRes();
    await handleApiRoute(
      makeReq({
        url: "/api/repos/o/r/ingest-graph",
        method: "POST",
        headers: AUTH,
        body: { kinds: ["specs"], commit: "abc123" },
      }),
      res,
      makePool() as any,
    );
    expect(fetchMock.mock.calls[0][0]).toContain("/api/trigger/spec-trace");
    expect(createIngestGraphTasks).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({ triggered: ["specs"] });
  });

  it("keeps the task path for the tests kind and fires no doc trigger", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    vi.mocked(createIngestGraphTasks).mockResolvedValue({
      groupId: "g1",
      created: [{ id: "t1", kind: "tests" }],
      skipped: [],
    });
    const res = makeRes();
    await handleApiRoute(
      makeReq({
        url: "/api/repos/o/r/ingest-graph",
        method: "POST",
        headers: AUTH,
        body: { kinds: ["tests"] },
      }),
      res,
      makePool() as any,
    );
    expect(createIngestGraphTasks).toHaveBeenCalledWith(
      expect.anything(),
      "o/r",
      expect.objectContaining({ kinds: ["tests"] }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({ tasks: { created: [{ id: "t1", kind: "tests" }] } });
  });

  it("returns 503 without firing a doc trigger when a mixed request hits a pool-less server", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/ingest-graph", method: "POST", headers: AUTH, body: { kinds: ["specs", "tests"] } }),
      res,
      null,
    );
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createIngestGraphTasks).not.toHaveBeenCalled();
  });
});
