import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("../../../features/spec-trace/ingest.js", () => ({ ingestFiles: vi.fn() }));

import { ingestFiles } from "../../../features/spec-trace/ingest.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const post = (body: unknown, pool: unknown) =>
  buildServer(() => pool as any).inject({ method: "POST", url: "/api/ingest", headers: AUTH, payload: JSON.stringify(body) });
const insertCalls = (pool: ReturnType<typeof makePool>) =>
  pool.query.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO pipeline.events"));

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
    // A valid body (validation runs before the handler's pool guard now — ADR-034).
    const res = await post({ files: ["a.ts"], repo: "o/r" }, null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when files is not an array", async () => {
    const res = await post({ repo: "o/r" }, makePool());
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 and inserts a spec-coverage-validate event when a file lands", async () => {
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "ingested" }] } as any);
    const pool = makePool();
    const res = await post({ files: ["a.ts"], repo: "o/r" }, pool);
    expect(res.statusCode).toBe(200);
    expect(insertCalls(pool)[0]?.[1]?.[0]).toBe("internal.ingest.spec_coverage_validate");
  });

  it("returns 400 when repo is missing", async () => {
    const res = await post({ files: ["a.ts"] }, makePool());
    expect(res.statusCode).toBe(400);
  });

  it("treats a deleted status as a landed file and inserts the event", async () => {
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "deleted" }] } as any);
    const pool = makePool();
    const res = await post({ files: ["a.ts"], repo: "o/r" }, pool);
    expect(res.statusCode).toBe(200);
    expect(insertCalls(pool)[0]?.[1]?.[0]).toBe("internal.ingest.spec_coverage_validate");
  });

  it("does not insert an event when nothing landed", async () => {
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "skipped" }] } as any);
    const pool = makePool();
    await post({ files: ["a.ts"], repo: "o/r" }, pool);
    expect(insertCalls(pool)).toHaveLength(0);
  });

  it("does not fire the trigger when the result has no results array", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    vi.mocked(ingestFiles).mockResolvedValue({} as any);
    await post({ files: ["a.ts"], repo: "o/r" }, makePool());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 when ingestFiles throws", async () => {
    vi.mocked(ingestFiles).mockRejectedValue(new Error("ingest fail"));
    const res = await post({ files: ["a.ts"], repo: "o/r" }, makePool());
    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: "ingest fail" });
  });
});
