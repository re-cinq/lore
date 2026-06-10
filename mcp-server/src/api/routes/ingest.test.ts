import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleApiRoute } from "../routes.js";
import { makeReq, makeRes, makePool, useRateLimitSafeClock, AUTH, LEGACY_TOKEN } from "../../test-helpers/http-mock.js";

vi.mock("../../features/spec-trace/ingest.js", () => ({ ingestFiles: vi.fn() }));
vi.mock("../../features/spec-trace/ingest-graph-tasks.js", () => ({ maybeAutoIngestGraph: vi.fn() }));

import { ingestFiles } from "../../features/spec-trace/ingest.js";
import { maybeAutoIngestGraph } from "../../features/spec-trace/ingest-graph-tasks.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

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
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: {} }), res, null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when files is not an array", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { repo: "o/r" } }), res, pool as any);
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 and fires the spec-coverage trigger when a file lands", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "ingested" }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/trigger/spec-coverage-validate");
  });

  it("returns 400 when repo is missing", async () => {
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"] } }), res, pool as any);
    expect(res.statusCode).toBe(400);
    expect(res.json).toEqual({ error: "required: files (array of paths or {path,content}), repo (string)" });
  });

  it("fires the graph auto-ingest fan-out when a file lands", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 })) as typeof fetch;
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "ingested" }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(maybeAutoIngestGraph).toHaveBeenCalledWith(pool, "o/r");
  });

  it("treats a deleted status as a landed file and fires the trigger", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as typeof fetch;
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "deleted" }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/trigger/spec-coverage-validate");
  });

  it("does not fire the graph fan-out when nothing landed", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    globalThis.fetch = vi.fn();
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "skipped" }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(maybeAutoIngestGraph).not.toHaveBeenCalled();
  });

  it("does not fire the trigger when nothing landed", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    vi.mocked(ingestFiles).mockResolvedValue({ results: [{ status: "skipped" }] } as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fire the trigger when the result has no results array", async () => {
    process.env.LORE_AGENT_URL = "http://agent:8080";
    process.env.LORE_AGENT_INTERNAL_TOKEN = "tok";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    vi.mocked(ingestFiles).mockResolvedValue({} as any);
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 when ingestFiles throws", async () => {
    vi.mocked(ingestFiles).mockRejectedValue(new Error("ingest fail"));
    const pool = makePool();
    const res = makeRes();
    await handleApiRoute(
      makeReq({ url: "/api/ingest", method: "POST", headers: AUTH, body: { files: ["a.ts"], repo: "o/r" } }),
      res,
      pool as any,
    );
    expect(res.statusCode).toBe(500);
    expect(res.json).toEqual({ error: "ingest fail" });
  });
});
