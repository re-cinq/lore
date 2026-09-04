import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Pool } from "pg";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setPool } from "@re-cinq/lore-server-core/platform/db.js";

const originalEnv = { ...process.env };
const get = (url: string, headers?: Record<string, string>) =>
  buildServer(() => makePool() as any).inject({ method: "GET", url, headers });

describe("GET /api/repos/:owner/:repo/trace/:kind", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 404 for an unknown trace kind", async () => {
    const res = await get("/api/repos/o/r/trace/bogus", AUTH);

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "not found" });
  });

  it("returns 401 without a bearer token", async () => {
    const res = await get("/api/repos/o/r/trace/specs");

    expect(res.statusCode).toBe(401);
  });

  it("passes read-scope auth for a matched kind (no 401/403 gate hit)", async () => {
    const res = await get("/api/repos/o/r/trace/bogus", AUTH);

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 400 when the path query exceeds the length bound", async () => {
    const res = await get(
      `/api/repos/o/r/trace/document?path=${"x".repeat(1025)}`,
      AUTH,
    );

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/trace/specs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 200 with an empty specs list when Dgraph is not configured", async () => {
    const res = await get("/api/trace/specs", AUTH);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ specs: [] });
  });

  it("returns 401 without a bearer token", async () => {
    const res = await get("/api/trace/specs");

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/repos/:owner/:repo/trace/:kind — per-kind dispatch", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    delete process.env.LORE_DGRAPH_HTTP;
    setPool(makePool() as unknown as Pool);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setPool(null as unknown as Pool);
    vi.clearAllMocks();
  });

  const NO_DGRAPH_ERROR =
    "lore-api has no Dgraph client (LORE_DGRAPH_HTTP unset)";

  it("dispatches specs and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get("/api/repos/o/r/trace/specs", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("dispatches spec-summaries and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get("/api/repos/o/r/trace/spec-summaries", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("dispatches adrs and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get("/api/repos/o/r/trace/adrs", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("dispatches adr-summaries and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get("/api/repos/o/r/trace/adr-summaries", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("dispatches graph, with a clean project.features.list() read, and surfaces the no-op Dgraph failure as 500", async () => {
    setPool({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool);
    const res = await get("/api/repos/o/r/trace/graph", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("returns 400 when document is requested without a path", async () => {
    const res = await get("/api/repos/o/r/trace/document", AUTH);

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "path query param required" });
  });

  it("dispatches document with a path and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get(
      "/api/repos/o/r/trace/document?path=specs/a.md",
      AUTH,
    );

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("returns 400 when ring is requested without a path", async () => {
    const res = await get("/api/repos/o/r/trace/ring", AUTH);

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "path query param required" });
  });

  it("dispatches ring with a path and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get("/api/repos/o/r/trace/ring?path=specs/a.md", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });

  it("returns 400 when source is requested without a path", async () => {
    const res = await get("/api/repos/o/r/trace/source", AUTH);

    expect(res.statusCode).toBe(400);
    expect(res.result).toEqual({ error: "path query param required" });
  });

  it("dispatches source (the default kind) with a path and surfaces the no-op Dgraph failure as 500", async () => {
    const res = await get("/api/repos/o/r/trace/source?path=specs/a.md", AUTH);

    expect(res.statusCode).toBe(500);
    expect(res.result).toEqual({ error: NO_DGRAPH_ERROR });
  });
});
