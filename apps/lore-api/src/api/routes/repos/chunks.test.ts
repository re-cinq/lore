import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fakeChunks = {
  specChunks: vi.fn(async () => ["spec-1"]),
  codeSymbols: vi.fn(async () => ["symbol-1"]),
  specChunksWithIngest: vi.fn(async () => ["spec-2"]),
  testChunkRanges: vi.fn(async () => ["range-1"]),
  specChunksForBackfill: vi.fn(async () => ["spec-3"]),
  codeChunksForBackfill: vi.fn(async () => ["chunk-1"]),
  hasChunk: vi.fn(async () => true),
  staleChunkCount: vi.fn(async () => 3),
};

vi.mock("../../../platform/project-boot.js", () => ({
  projectFor: vi.fn(async () => ({ chunks: fakeChunks })),
}));

import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (kind: string, query = "") =>
  buildServer(() => makePool() as never).inject({
    method: "GET",
    url: `/api/repos/re-cinq/lore/chunks/${kind}${query}`,
    headers: AUTH,
  });

describe("GET /api/repos/{owner}/{repo}/chunks/{kind}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 404 for an unknown kind", async () => {
    const res = await get("nonsense");

    expect(res.statusCode).toBe(404);
  });

  it("returns spec chunks for kind=spec", async () => {
    const res = await get("spec");

    expect(res.result).toEqual({ specs: ["spec-1"] });
  });

  it("returns code symbols for kind=code-symbols", async () => {
    const res = await get("code-symbols");

    expect(res.result).toEqual({ symbols: ["symbol-1"] });
  });

  it("returns ingest-annotated spec chunks for kind=spec-ingest", async () => {
    const res = await get("spec-ingest");

    expect(res.result).toEqual({ specs: ["spec-2"] });
  });

  it("returns test chunk ranges for kind=test-ranges", async () => {
    const res = await get("test-ranges");

    expect(res.result).toEqual({ ranges: ["range-1"] });
  });

  it("returns backfill spec chunks for kind=spec-backfill", async () => {
    const res = await get("spec-backfill");

    expect(res.result).toEqual({ specs: ["spec-3"] });
  });

  it("returns backfill code chunks for kind=code-backfill", async () => {
    const res = await get("code-backfill");

    expect(res.result).toEqual({ chunks: ["chunk-1"] });
  });

  it("returns whether a chunk exists for kind=has with a content_type", async () => {
    const res = await get("has", "?content_type=spec&file_suffix=.md");

    expect(res.result).toEqual({ has: true });
    expect(fakeChunks.hasChunk).toHaveBeenCalledWith("spec", ".md");
  });

  it("returns 400 for kind=has without a content_type", async () => {
    const res = await get("has");

    expect(res.statusCode).toBe(400);
  });

  it("returns the stale count with a default 90-day window for kind=stale", async () => {
    const res = await get("stale");

    expect(res.result).toEqual({ count: 3 });
    expect(fakeChunks.staleChunkCount).toHaveBeenCalledWith(90);
  });

  it("returns the stale count for an explicit days window", async () => {
    const res = await get("stale", "?days=30");

    expect(res.result).toEqual({ count: 3 });
    expect(fakeChunks.staleChunkCount).toHaveBeenCalledWith(30);
  });

  it("returns 500 when the chunk read throws", async () => {
    fakeChunks.specChunks.mockRejectedValueOnce(new Error("db down"));

    const res = await get("spec");

    expect(res.statusCode).toBe(500);
  });
});
