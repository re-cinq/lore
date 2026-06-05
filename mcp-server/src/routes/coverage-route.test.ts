import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("POST /api/repos/:owner/:repo/coverage", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 with node, edge, and file counts derived from the body", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      coverage: [
        { test: "t1", covered: [
          { file: "a.ts", startLine: 1, endLine: 2 },
          { file: "a.ts", startLine: 5, endLine: 5 },
        ] },
        { test: "t2", covered: [
          { file: "b.ts", startLine: 1, endLine: 1 },
        ] },
      ],
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/coverage", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ coverage_nodes: 2, covers_edges: 3, files_covered: 2 });
  });

  it("returns 200 with counts from a normalized lcov payload", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      format: "lcov",
      payload: "SF:src/a.ts\nDA:1,1\nDA:3,1\nend_of_record\nSF:src/b.ts\nDA:5,1\nend_of_record\n",
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/coverage", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ coverage_nodes: 2, covers_edges: 3, files_covered: 2 });
  });

  it("counts per-test nodes for an lcov payload with two TN tests on the same file", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      format: "lcov",
      payload:
        "TN:test one\nSF:src/a.ts\nDA:1,1\nend_of_record\nTN:test two\nSF:src/a.ts\nDA:5,1\nend_of_record\n",
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/coverage", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ coverage_nodes: 2, covers_edges: 2, files_covered: 1 });
  });

  it("returns 200 with counts from a normalized cobertura payload", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = {
      commit: "abc123",
      branch: "main",
      format: "cobertura",
      payload:
        '<coverage><packages><package><classes><class filename="src/a.ts"><lines><line number="10" hits="3"/><line number="11" hits="1"/><line number="20" hits="2"/></lines></class></classes></package></packages></coverage>',
    };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/coverage", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ coverage_nodes: 1, covers_edges: 2, files_covered: 1 });
  });

  it("returns 400 for an unsupported format", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = { commit: "abc123", branch: "main", format: "clover", payload: "whatever" };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/coverage", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json.error).toBeTruthy();
  });

  it("returns 400 when commit is missing", async () => {
    const pool = makePool();
    const res = makeRes();
    const body = { branch: "main", coverage: [] };
    await handleApiRoute(
      makeReq({ url: "/api/repos/o/r/coverage", method: "POST", headers: AUTH, body }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json.error).toBeTruthy();
  });
});
