import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/context/context-assembly.js", () => ({ assembleContext: vi.fn() }));

import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";

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

  it("passes debug=1 through and returns the trace in the envelope", async () => {
    vi.mocked(assembleContext).mockResolvedValue({ text: "ctx", sections: [], trace: [{ section: "repo", included: true }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?query=hi&debug=1", headers: AUTH }), res, pool as any);
    // Trailing null is the Dgraph port — createDgraphClient returns null when LORE_DGRAPH_HTTP is unset.
    expect(vi.mocked(assembleContext).mock.calls[0]).toEqual([pool, "hi", "default", 8000, undefined, undefined, false, undefined, true, null]);
    expect(res.json).toEqual({ text: "ctx", sections: [], trace: [{ section: "repo", included: true }] });
  });

  it("forwards max_tokens, agent_id, and cross_repo through to assembleContext", async () => {
    vi.mocked(assembleContext).mockResolvedValue({ text: "ctx", sections: [] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/context?query=hi&repo=o/r&max_tokens=16000&agent_id=a-1&cross_repo=true", headers: AUTH }),
      res,
      pool as any,
    );
    const call = vi.mocked(assembleContext).mock.calls[0];
    expect(call[3]).toBe(16000);
    expect(call[5]).toBe("a-1");
    expect(call[6]).toBe(true);
  });

  it("keeps the 8000 default when max_tokens is absent or invalid", async () => {
    vi.mocked(assembleContext).mockResolvedValue({ text: "ctx", sections: [] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?query=hi&max_tokens=abc", headers: AUTH }), res, pool as any);
    expect(vi.mocked(assembleContext).mock.calls[0][3]).toBe(8000);
  });

  it("enables cross_repo from repo settings when the param is not set", async () => {
    vi.mocked(assembleContext).mockResolvedValue({ text: "ctx", sections: [] } as any);
    const pool = makePool();
    pool.query.mockResolvedValue({ rows: [{ settings: { cross_repo: true } }] });
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/context?query=hi&repo=o/r", headers: AUTH }), res, pool as any);
    expect(vi.mocked(assembleContext).mock.calls[0][6]).toBe(true);
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
