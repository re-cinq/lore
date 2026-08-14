import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("memory browse reads", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(url: string, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url,
      headers: AUTH,
    });
  }

  describe("GET /api/graph-browse", () => {
    it("returns 503 when pool is null", async () => {
      expect((await get("/api/graph-browse", null)).statusCode).toBe(503);
    });

    it("returns the counts, the type breakdown and the entity list", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ entity_count: 9 }] })
        .mockResolvedValueOnce({ rows: [{ entity_type: "service", cnt: 4 }] })
        .mockResolvedValueOnce({ rows: [{ id: "e1", name: "lore-api" }] });

      expect((await get("/api/graph-browse", pool)).result).toEqual({
        stats: { entity_count: 9 },
        entity_types: [{ entity_type: "service", cnt: 4 }],
        entities: [{ id: "e1", name: "lore-api" }],
        edges: [],
      });
    });

    it("reads no edges until an entity is named", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/graph-browse", pool);

      expect(
        pool.query.mock.calls.some(([sql]) =>
          String(sql).includes("JOIN memory.entities s"),
        ),
      ).toBe(false);
    });

    it("reads the named entity's edges, hiding invalidated ones by default", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/graph-browse?entity=lore-api", pool);

      const edgeCall = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes("JOIN memory.entities s"),
      );

      expect(edgeCall?.[0]).toContain("AND e.valid_to IS NULL");
      expect(edgeCall?.[1]).toEqual(["lore-api"]);
    });

    it("includes invalidated edges when asked", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/graph-browse?entity=lore-api&show_invalid=true", pool);

      const edgeCall = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes("JOIN memory.entities s"),
      );

      expect(edgeCall?.[0]).not.toContain("AND e.valid_to IS NULL");
    });

    it("filters the entity list by type as a bound parameter", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/graph-browse?type=service", pool);

      const listCall = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes("FROM memory.entities en"),
      );

      expect(listCall?.[1]).toEqual(["service"]);
    });
  });

  describe("GET /api/pools", () => {
    it("returns the pools with their entry and agent counts", async () => {
      const pool = makePool();
      const pools = [{ id: "p1", name: "platform", entry_count: 3 }];

      pool.query.mockResolvedValue({ rows: pools });

      expect((await get("/api/pools", pool)).result).toEqual({ pools });
    });
  });

  describe("GET /api/pools/{name}", () => {
    it("returns the pool and its entries", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: "p1", name: "platform" }] })
        .mockResolvedValueOnce({ rows: [{ id: "m1", key: "k" }] });

      expect((await get("/api/pools/platform", pool)).result).toEqual({
        pool: { id: "p1", name: "platform" },
        entries: [{ id: "m1", key: "k" }],
      });
    });

    it("returns 404 for a pool that does not exist", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      expect((await get("/api/pools/nope", pool)).statusCode).toBe(404);
    });
  });

  describe("GET /api/episodes", () => {
    it("returns the page and the unpaged total", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 42 }] })
        .mockResolvedValueOnce({ rows: [{ id: "ep1" }] });

      expect((await get("/api/episodes", pool)).result).toEqual({
        episodes: [{ id: "ep1" }],
        total: 42,
      });
    });

    it("filters by source and agent as bound parameters", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ count: 0 }] });
      await get("/api/episodes?source=session&agent=klaus", pool);

      expect(pool.query.mock.calls[0][1]).toEqual(["session", "klaus"]);
    });
  });

  describe("GET /api/memory-search", () => {
    it("returns the memory hits and the fact hits as one ranked list", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ key: "k1", score: 0.9 }] })
        .mockResolvedValueOnce({ rows: [{ key: "k2", score: 0.4 }] });

      expect((await get("/api/memory-search?q=cache", pool)).result).toEqual({
        results: [
          { key: "k1", score: 0.9 },
          { key: "k2", score: 0.4 },
        ],
      });
    });

    it("binds the query text to both searches", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/memory-search?q=cache", pool);

      expect(pool.query.mock.calls[0][1]).toEqual(["cache"]);
      expect(pool.query.mock.calls[1][1]).toEqual(["cache"]);
    });

    it("requires a query", async () => {
      expect((await get("/api/memory-search")).statusCode).toBe(400);
    });
  });

  describe("GET /api/memories", () => {
    it("returns an agent's live memories with their versions and facts", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: "m1", key: "k", has_facts: true }],
        })
        .mockResolvedValueOnce({ rows: [{ version: 2, value: "v" }] })
        .mockResolvedValueOnce({ rows: [{ fact_text: "f" }] });

      expect((await get("/api/memories?agent=klaus", pool)).result).toEqual({
        memories: [
          {
            id: "m1",
            key: "k",
            has_facts: true,
            versions: [{ version: 2, value: "v" }],
            facts: [{ fact_text: "f" }],
          },
        ],
      });
    });

    it("skips the fact read for a memory that has none", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: "m1", has_facts: false }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await get("/api/memories?agent=klaus", pool);

      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(res.result).toMatchObject({ memories: [{ facts: [] }] });
    });

    it("requires an agent", async () => {
      expect((await get("/api/memories")).statusCode).toBe(400);
    });
  });
});
