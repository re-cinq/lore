import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("POST /api/repos/:owner/:repo/test-report", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 with counts derived from tests and results", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      tests: [
        { id: "t1", name: "a", file: "a.test.ts", startLine: 1, endLine: 5, spec: "specs/x/spec.md#3" },
        { id: "t2", name: "b", file: "b.test.ts", startLine: 1, endLine: 5 },
      ],
      results: [
        { id: "t1", passed: true, covered: [{ file: "a.ts", startLine: 1, endLine: 2 }] },
        { id: "t2", passed: true, covered: [
          { file: "b.ts", startLine: 1, endLine: 1 },
          { file: "b.ts", startLine: 5, endLine: 5 },
        ] },
      ],
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/test-report", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({
      tests_seen: 2,
      test_chunks: 2,
      validated_by: 1,
      coverage_nodes: 2,
      covers_edges: 3,
      violated: 0,
    });
  });

  it("returns violated 1 when only the spec-anchored test fails", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      tests: [
        { id: "t1", name: "a", file: "a.test.ts", startLine: 1, endLine: 5, spec: "specs/x/spec.md#3" },
        { id: "t2", name: "b", file: "b.test.ts", startLine: 1, endLine: 5 },
      ],
      results: [
        { id: "t1", passed: false, covered: [] },
        { id: "t2", passed: false, covered: [] },
      ],
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/test-report", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json?.violated).toBe(1);
  });

  it("fires the spec-trace trigger with the report body when the agent env is configured", async () => {
    const originalFetch = globalThis.fetch;
    process.env.LORE_AGENT_URL = "http://agent.internal:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "test-secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      tests: [{ id: "t1", name: "a", file: "a.test.ts", startLine: 1, endLine: 5, spec: "specs/x/spec.md#3" }],
      results: [{ id: "t1", passed: true, covered: [] }],
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/test-report", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    globalThis.fetch = originalFetch;
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("http://agent.internal:8080/api/trigger/spec-trace");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      repo: "o/r",
      kind: "test-report",
      payload: body,
    });
  });

  it("returns 400 when commit is missing", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = { branch: "main", tests: [], results: [] };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/test-report", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json.error).toBeTruthy();
  });
});
