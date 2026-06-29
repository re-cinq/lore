import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

/**
 * POST /api/repos/:owner/:repo/ingest-graph — the REST/curl/CI (re-)projection
 * trigger. Only docs (specs/adrs) project here, each firing the fire-and-forget
 * spec-trace trigger; no pipeline task. Test projection is CI-only.
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
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({ triggered: ["specs"] });
  });

  it("rejects the tests kind with 400 and fires no trigger (test projection is CI-only)", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/ingest-graph", method: "POST", headers: AUTH, body: { kinds: ["tests"] } }),
      res,
      makePool() as any,
    );
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
