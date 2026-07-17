import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock(
  "@re-cinq/lore-server-core/features/context/context-assembly.js",
  () => ({ assembleContext: vi.fn() }),
);

import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url: string) =>
  buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

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
    vi.mocked(assembleContext).mockResolvedValue({
      text: "ctx",
      sections: [{ a: 1 }],
    } as any);
    const res = await get(makePool(), "/api/context?query=hi&repo=o/r");

    expect(res.result).toEqual({ text: "ctx", sections: [{ a: 1 }] });
  });

  it("passes debug=1 through and returns the trace in the envelope", async () => {
    vi.mocked(assembleContext).mockResolvedValue({
      text: "ctx",
      sections: [],
      trace: [{ section: "repo", included: true }],
    } as any);
    const pool = makePool();
    const res = await get(pool, "/api/context?query=hi&debug=1");

    // Trailing null is the Dgraph port — createDgraphClient returns null when LORE_DGRAPH_HTTP is unset.
    expect(vi.mocked(assembleContext).mock.calls[0]).toEqual([
      pool,
      "hi",
      "default",
      8000,
      undefined,
      undefined,
      false,
      undefined,
      true,
      null,
    ]);
    expect(res.result).toEqual({
      text: "ctx",
      sections: [],
      trace: [{ section: "repo", included: true }],
    });
  });

  it("forwards max_tokens, agent_id, and cross_repo through to assembleContext", async () => {
    vi.mocked(assembleContext).mockResolvedValue({
      text: "ctx",
      sections: [],
    } as any);
    await get(
      makePool(),
      "/api/context?query=hi&repo=o/r&max_tokens=16000&agent_id=a-1&cross_repo=true",
    );
    const call = vi.mocked(assembleContext).mock.calls[0];

    expect(call[3]).toBe(16000);
    expect(call[5]).toBe("a-1");
    expect(call[6]).toBe(true);
  });

  it("keeps the 8000 default when max_tokens is absent or invalid", async () => {
    vi.mocked(assembleContext).mockResolvedValue({
      text: "ctx",
      sections: [],
    } as any);
    await get(makePool(), "/api/context?query=hi&max_tokens=abc");
    expect(vi.mocked(assembleContext).mock.calls[0][3]).toBe(8000);
  });

  it("enables cross_repo from repo settings when the param is not set", async () => {
    vi.mocked(assembleContext).mockResolvedValue({
      text: "ctx",
      sections: [],
    } as any);
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ settings: { cross_repo: true } }],
    });
    await get(pool, "/api/context?query=hi&repo=o/r");
    expect(vi.mocked(assembleContext).mock.calls[0][6]).toBe(true);
  });

  it("nulls text when assembleContext returns empty text", async () => {
    vi.mocked(assembleContext).mockResolvedValue({
      text: "",
      sections: [],
    } as any);
    const res = await get(makePool(), "/api/context?query=hi");

    expect(res.result).toEqual({ text: null, sections: [] });
  });

  it("joins repo chunks when no query but repo + pool present", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ content: "A" }, { content: "B" }],
    });
    const res = await get(pool, "/api/context?repo=o/r");

    expect(res.result).toEqual({ text: "A\n\n---\n\nB" });
  });

  it("caps the no-query chunk join at max_tokens*4 chars — whole chunks kept until the budget is hit", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        { content: "a".repeat(3000) },
        { content: "b".repeat(3000) },
        { content: "c".repeat(3000) },
      ],
    });
    const res = await get(pool, "/api/context?repo=o/r&max_tokens=1000");
    const text = (res.result as { text: string }).text;

    expect(text).toBe("a".repeat(3000));
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it("no-query join respects the 8000-token default when max_tokens is absent", async () => {
    const pool = makePool();
    const bigChunk = "x".repeat(30000);

    pool.query.mockResolvedValue({
      rows: [{ content: bigChunk }, { content: bigChunk }],
    });
    const res = await get(pool, "/api/context?repo=o/r");

    expect((res.result as { text: string }).text).toBe(bigChunk);
  });

  it("nulls text when repo chunks are empty", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await get(pool, "/api/context?repo=o/r");

    expect(res.result).toEqual({ text: null });
  });

  it("nulls text when neither query nor repo provided", async () => {
    const res = await get(null, "/api/context");

    expect(res.result).toEqual({ text: null });
  });

  it("returns 500 when assembleContext throws", async () => {
    vi.mocked(assembleContext).mockRejectedValue(new Error("ctx fail"));
    const res = await get(makePool(), "/api/context?query=hi");

    expect(res.statusCode).toBe(500);
  });

  it("returns 400 for an unknown template", async () => {
    const res = await get(makePool(), "/api/context?query=hi&template=bogus");

    expect(res.statusCode).toBe(400);
  });
});
