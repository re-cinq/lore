import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

/**
 * The schema union is the whole point of these cases. A chunk read spans every
 * provisioned team schema plus `org_shared`, and getting the schema set wrong
 * means the context browser silently shows another team's chunks — or none.
 */
describe("chunk browse reads", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  /** The catalog reads every union does first: the referenced teams, then the
   *  schemas that actually hold a `chunks` table. */
  function poolWithSchemas(teams: string[], provisioned: string[]) {
    const pool = makePool();

    pool.query.mockImplementation((sql: string) => {
      if (String(sql).includes("SELECT DISTINCT team")) {
        return Promise.resolve({ rows: teams.map((t) => ({ team: t })) });
      }

      if (String(sql).includes("information_schema.tables")) {
        return Promise.resolve({
          rows: provisioned.map((s) => ({ table_schema: s })),
        });
      }

      if (String(sql).includes("SELECT team FROM lore.repos")) {
        return Promise.resolve({ rows: [{ team: teams[0] ?? null }] });
      }

      return Promise.resolve({ rows: [{ id: "c1", content_type: "spec" }] });
    });

    return pool;
  }

  function get(url: string, pool: unknown = poolWithSchemas([], [])) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url,
      headers: AUTH,
    });
  }

  describe("GET /api/chunks", () => {
    it("returns 503 when pool is null", async () => {
      expect((await get("/api/chunks", null)).statusCode).toBe(503);
    });

    it("unions every provisioned team schema plus org_shared", async () => {
      const pool = poolWithSchemas(
        ["platform", "growth"],
        ["platform", "growth"],
      );

      await get("/api/chunks", pool);

      const union = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes("UNION ALL"),
      );

      expect(union?.[0]).toContain("platform.chunks");
      expect(union?.[0]).toContain("growth.chunks");
      expect(union?.[0]).toContain("org_shared.chunks");
    });

    it("skips a team whose schema was never provisioned", async () => {
      // `lore.repos.team` is free text: it can name a schema that does not
      // exist, and unioning it would make every chunk read fail.
      const pool = poolWithSchemas(["platform", "ghost"], ["platform"]);

      await get("/api/chunks", pool);

      const union = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes("UNION ALL"),
      );

      expect(union?.[0]).not.toContain("ghost.chunks");
    });

    it("reads one repo's own schema rather than the union when a repo is named", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      await get("/api/chunks?repo=re-cinq/lore", pool);

      const read = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes(".chunks"),
      );

      expect(read?.[0]).not.toContain("UNION ALL");
      expect(read?.[0]).toContain("platform.chunks");
    });

    it("binds the type filter and the search text", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      await get("/api/chunks?repo=re-cinq/lore&type=spec&q=cache", pool);

      const read = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes(".chunks"),
      );

      expect(read?.[1]).toEqual(
        expect.arrayContaining(["re-cinq/lore", "spec", "cache"]),
      );
    });

    it("asks for one row past the page size so the caller can detect more", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      await get("/api/chunks?repo=re-cinq/lore&limit=10", pool);

      const read = pool.query.mock.calls.find(([sql]) =>
        String(sql).includes(".chunks"),
      );

      expect(read?.[0]).toContain("11");
    });
  });

  describe("GET /api/chunk-types", () => {
    it("returns the distinct content types across the union", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      pool.query.mockImplementation((sql: string) => {
        if (String(sql).includes("SELECT DISTINCT team")) {
          return Promise.resolve({ rows: [{ team: "platform" }] });
        }

        if (String(sql).includes("information_schema.tables")) {
          return Promise.resolve({ rows: [{ table_schema: "platform" }] });
        }

        return Promise.resolve({
          rows: [{ content_type: "spec" }, { content_type: "spec" }],
        });
      });

      expect((await get("/api/chunk-types", pool)).result).toEqual({
        types: ["spec"],
      });
    });
  });

  describe("GET /api/repos/{owner}/{repo}/chunk-summary", () => {
    it("returns the repo's chunk count and which convention files it holds", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      pool.query.mockImplementation((sql: string) => {
        if (String(sql).includes("SELECT DISTINCT team")) {
          return Promise.resolve({ rows: [{ team: "platform" }] });
        }

        if (String(sql).includes("information_schema.tables")) {
          return Promise.resolve({ rows: [{ table_schema: "platform" }] });
        }

        if (String(sql).includes("SELECT team FROM lore.repos")) {
          return Promise.resolve({ rows: [{ team: "platform" }] });
        }

        if (String(sql).includes("count(*)")) {
          return Promise.resolve({ rows: [{ count: 42 }] });
        }

        return Promise.resolve({ rows: [{ file_path: "AGENTS.md" }] });
      });

      expect(
        (await get("/api/repos/re-cinq/lore/chunk-summary", pool)).result,
      ).toEqual({ count: 42, convention_files: ["AGENTS.md"] });
    });

    it("answers a zero count rather than failing when the schema holds nothing", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      pool.query.mockImplementation((sql: string) => {
        if (String(sql).includes("SELECT DISTINCT team")) {
          return Promise.resolve({ rows: [{ team: "platform" }] });
        }

        if (String(sql).includes("information_schema.tables")) {
          return Promise.resolve({ rows: [{ table_schema: "platform" }] });
        }

        return Promise.resolve({ rows: [] });
      });

      expect(
        (await get("/api/repos/re-cinq/lore/chunk-summary", pool)).result,
      ).toEqual({ count: 0, convention_files: [] });
    });
  });

  describe("GET /api/chunks/by-path", () => {
    it("groups a path's chunks by the repo that holds them", async () => {
      const pool = poolWithSchemas(["platform"], ["platform"]);

      pool.query.mockImplementation((sql: string) => {
        if (String(sql).includes("SELECT DISTINCT team")) {
          return Promise.resolve({ rows: [{ team: "platform" }] });
        }

        if (String(sql).includes("information_schema.tables")) {
          return Promise.resolve({ rows: [{ table_schema: "platform" }] });
        }

        return Promise.resolve({
          rows: [
            { id: "a", repo: "re-cinq/lore" },
            { id: "b", repo: "re-cinq/other" },
          ],
        });
      });

      expect(
        (await get("/api/chunks/by-path?path=specs%2Fx%2Fspec.md", pool))
          .result,
      ).toEqual({
        chunks: [
          { id: "a", repo: "re-cinq/lore" },
          { id: "b", repo: "re-cinq/other" },
        ],
      });
    });

    it("requires a path", async () => {
      expect((await get("/api/chunks/by-path")).statusCode).toBe(400);
    });
  });
});
