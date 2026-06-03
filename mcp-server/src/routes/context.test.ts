import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../test-helpers/http-mock.js";

vi.mock("../context-assembly.js", () => ({ assembleContext: vi.fn() }));

import { assembleContext } from "../context-assembly.js";

const originalEnv = { ...process.env };

describe("GET /api/context", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns assembled context when query + pool present", async () => {
    vi.mocked(assembleContext).mockResolvedValue({ text: "ctx", sections: [{ a: 1 }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?query=hi&repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ text: "ctx", sections: [{ a: 1 }] });
  });

  it("nulls text when assembleContext returns empty text", async () => {
    vi.mocked(assembleContext).mockResolvedValue({ text: "", sections: [] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?query=hi", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ text: null, sections: [] });
  });

  it("joins repo chunks when no query but repo + pool present", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ content: "A" }, { content: "B" }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ text: "A\n\n---\n\nB" });
  });

  it("nulls text when repo chunks are empty", async () => {
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?repo=o/r", headers: AUTH }), res, pool as any);
    expect(res.json).toEqual({ text: null });
  });

  it("nulls text when neither query nor repo provided", async () => {
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context", headers: AUTH }), res, null);
    expect(res.json).toEqual({ text: null });
  });

  it("returns 500 when assembleContext throws", async () => {
    vi.mocked(assembleContext).mockRejectedValue(new Error("ctx fail"));
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?query=hi", headers: AUTH }), res, pool as any);
    expect(res.statusCode).toBe(500);
  });
});
