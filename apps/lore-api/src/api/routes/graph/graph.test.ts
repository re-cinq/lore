import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/memory/graph.js", () => ({
  queryLiveGraph: vi.fn(),
  extractAndUpdateGraph: vi.fn(),
}));

import { queryLiveGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url: string) =>
  buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

describe("GET /api/graph", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the queryLiveGraph results, passing through entity/relation_type/repo", async () => {
    const rows = [
      { entity: "auth-service", relation: "uses", related_entity: "postgres" },
    ];
    vi.mocked(queryLiveGraph).mockResolvedValue(rows as any);
    const pool = makePool();
    const res = await get(
      pool,
      "/api/graph?entity=auth-service&relation_type=uses&repo=o/r",
    );
    expect(vi.mocked(queryLiveGraph).mock.calls[0]).toEqual([
      pool,
      "auth-service",
      "uses",
      "o/r",
      false,
    ]);
    expect(res.result).toEqual(rows);
  });

  it("parses include_invalidated=true", async () => {
    vi.mocked(queryLiveGraph).mockResolvedValue([] as any);
    const pool = makePool();
    await get(pool, "/api/graph?entity=x&include_invalidated=true");
    expect(vi.mocked(queryLiveGraph).mock.calls[0]).toEqual([
      pool,
      "x",
      undefined,
      undefined,
      true,
    ]);
  });

  it("returns 503 when no pool (graph needs Postgres)", async () => {
    const res = await get(null, "/api/graph?entity=x");
    expect(res.statusCode).toBe(503);
  });

  it("returns 500 when queryLiveGraph throws", async () => {
    vi.mocked(queryLiveGraph).mockRejectedValue(new Error("graph fail"));
    const res = await get(makePool(), "/api/graph?entity=x");
    expect(res.statusCode).toBe(500);
  });

  it("returns 400 when repo is not owner/name", async () => {
    const res = await get(makePool(), "/api/graph?entity=x&repo=bad");
    expect(res.statusCode).toBe(400);
  });
});
