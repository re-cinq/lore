import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../work/spec-trace/ingest.js", () => ({
  ingestFiles: vi.fn(),
}));

import { ingestFiles } from "../../../work/spec-trace/ingest.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const post = (body: unknown, pool: unknown) =>
  buildServer(() => pool as any).inject({
    method: "POST",
    url: "/api/ingest",
    headers: AUTH,
    payload: JSON.stringify(body),
  });
const insertCalls = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls.filter((c) =>
    String(c[0]).includes("INSERT INTO pipeline.events"),
  );

describe("POST /api/ingest", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await post({ files: ["a.ts"], repo: "o/r" }, null);

    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when files is not an array", async () => {
    const res = await post({ repo: "o/r" }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 and inserts no event when a file lands", async () => {
    vi.mocked(ingestFiles).mockResolvedValue({
      results: [{ status: "ingested" }],
    } as any);
    const pool = makePool();
    const res = await post({ files: ["a.ts"], repo: "o/r" }, pool);

    expect(res.statusCode).toBe(200);
    expect(insertCalls(pool)).toEqual([]);
  });

  it("returns 400 when repo is missing", async () => {
    const res = await post({ files: ["a.ts"] }, makePool());

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 when the result has no results array", async () => {
    vi.mocked(ingestFiles).mockResolvedValue({} as any);
    const res = await post({ files: ["a.ts"], repo: "o/r" }, makePool());

    expect(res.statusCode).toBe(200);
  });

  it("returns 500 when ingestFiles throws", async () => {
    vi.mocked(ingestFiles).mockRejectedValue(new Error("ingest fail"));
    const res = await post({ files: ["a.ts"], repo: "o/r" }, makePool());

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: "ingest fail" });
  });
});
