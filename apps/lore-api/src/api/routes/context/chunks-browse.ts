import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  ChunkSchema,
  CHUNK_COLUMNS,
} from "@re-cinq/lore-shared/models/chunk.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import {
  clampedLimit,
  offsetParam,
  DB_UNAVAILABLE,
} from "../common-schemas.js";
import { buildChunkUnionQuery } from "../../../features/chunks/chunk-union.js";
import {
  SCHEMA_RE,
  ORG_SHARED_SCHEMA,
  pickSchema,
} from "../../../features/chunks/repo-schema.js";
import { memoizeWithTtl } from "../../../features/chunks/ttl-memo.js";

/** Context browser chunk reads via schema union (ADR-032); queries per-team schemas + org_shared. */

const SCHEMA_CATALOG_TTL_MS = 30_000;

const ChunksQuery = z.object({
  repo: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  q: z.string().max(500).optional(),
  limit: clampedLimit.default(50),
  offset: offsetParam,
});

type ChunksQuery = z.infer<typeof ChunksQuery>;

const ByPathQuery = z.object({
  path: z.string().min(1).max(500),
  repo: z.string().max(200).optional(),
});

type ByPathQuery = z.infer<typeof ByPathQuery>;

/** Schemas that actually hold a `chunks` table, read from the catalog. */
function schemaReaders(pool: Pool) {
  const listChunkSchemas = memoizeWithTtl(async (): Promise<string[]> => {
    const { rows } = await pool.query(
      `SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'chunks' AND table_schema ~ '^[a-z][a-z0-9_]{0,62}$'`,
    );

    return rows
      .map((r) => r.table_schema as string)
      .filter((s: string) => SCHEMA_RE.test(s));
  }, SCHEMA_CATALOG_TTL_MS);

  /** Referenced, provisioned team schemas + org_shared. */
  const getChunkSchemas = memoizeWithTtl(async (): Promise<string[]> => {
    const { rows } = await pool.query(
      `SELECT DISTINCT team FROM lore.repos WHERE team IS NOT NULL AND team ~ '^[a-z][a-z0-9_]{0,62}$'`,
    );
    const existing = new Set(await listChunkSchemas());
    const schemas = rows
      .map((r) => r.team as string)
      .filter((s: string) => SCHEMA_RE.test(s) && existing.has(s));

    if (!schemas.includes(ORG_SHARED_SCHEMA)) {
      schemas.push(ORG_SHARED_SCHEMA);
    }

    return schemas;
  }, SCHEMA_CATALOG_TTL_MS);

  async function repoSchema(repo: string): Promise<string> {
    const { rows } = await pool.query<{ team: string | null }>(
      `SELECT team FROM lore.repos WHERE full_name = $1`,
      [repo],
    );

    return pickSchema(rows[0]?.team, await listChunkSchemas());
  }

  return { getChunkSchemas, repoSchema };
}

/** Chunk browse read model: content preview + rank are computed, rest derived from schema. */
const ChunkBrowseSchema = wireSchema(
  ChunkSchema.pick({
    id: true,
    filePath: true,
    contentType: true,
    repo: true,
    metadata: true,
    content: true,
    ingestedAt: true,
  }),
  CHUNK_COLUMNS,
).extend({
  /** `ts_rank` against the search query; 0 when the caller passed none. */
  rank: z.number().optional(),
});

const ChunkListSchema = z.object({ chunks: z.array(ChunkBrowseSchema) });

const ChunkByPathSchema = z.object({
  chunks: z.array(
    z.object({
      id: z.string(),
      content_type: z.string().nullable(),
      content: z.string(),
      metadata: z.record(z.unknown()).nullable(),
      repo: z.string().nullable(),
    }),
  ),
});

const ChunkTypeListSchema = z.object({ types: z.array(z.string()) });

const ChunkSummarySchema = z.object({
  count: z.number(),
  convention_files: z.array(z.string()),
});

export function chunkBrowseRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    listChunksRoute(getPool),
    chunkTypesRoute(getPool),
    chunkSummaryRoute(getPool),
    chunksByPathRoute(getPool),
  ];
}

function listChunksRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/chunks",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ChunksQuery) },
      },
      ChunkListSchema,
      { name: "ChunkList", description: "A page of ranked context chunks" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { repo, type, q, limit, offset } =
        request.query as unknown as ChunksQuery;
      const { getChunkSchemas, repoSchema } = schemaReaders(pool);

      // Limit+1 so caller detects another page without COUNT.
      const pageSize = limit + 1;

      const select = (schema: string, offset: number) => ({
        sql: `SELECT id, file_path, content_type, repo, metadata,
                     substring(content, 1, 300) as content, ingested_at,
                     CASE WHEN $${offset + 1}::text IS NULL THEN 0
                          ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $${offset + 1})) END as rank
                FROM ${schema}.chunks
               WHERE ($${offset}::text IS NULL OR content_type = $${offset})
                 AND ($${offset + 1}::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $${offset + 1}))`,
        params: [type || null, q || null],
      });
      const orderBy = q ? "rank DESC, id DESC" : "ingested_at DESC, id DESC";

      if (repo) {
        const schema = await repoSchema(repo);
        const { rows } = await pool.query(
          `SELECT id, file_path, content_type, repo, metadata,
                  substring(content, 1, 300) as content, ingested_at,
                  CASE WHEN $3::text IS NULL THEN 0
                       ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $3)) END as rank
             FROM ${schema}.chunks
            WHERE repo = $1
              AND ($2::text IS NULL OR content_type = $2)
              AND ($3::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $3))
            ORDER BY ${orderBy}
            LIMIT ${pageSize} OFFSET ${offset}`,
          [repo, type || null, q || null],
        );

        return h.response({ chunks: rows });
      }

      const union = buildChunkUnionQuery(await getChunkSchemas(), select, [], {
        orderBy,
        limit: pageSize,
      });

      if (union === null) {
        return h.response({ chunks: [] });
      }
      const { rows } = await pool.query(union.sql, union.params);

      return h.response({ chunks: rows });
    },
  };
}

function chunkTypesRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/chunk-types",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ChunksQuery.pick({ repo: true })) },
      },
      ChunkTypeListSchema,
      { name: "ChunkTypeList", description: "The content types in scope" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { repo } = request.query as { repo?: string };
      const { getChunkSchemas, repoSchema } = schemaReaders(pool);

      // Chips deliberately unfiltered so they don't disappear when selected.
      if (repo) {
        const schema = await repoSchema(repo);
        const { rows } = await pool.query<{ content_type: string }>(
          `SELECT DISTINCT content_type FROM ${schema}.chunks WHERE repo = $1`,
          [repo],
        );

        return h.response({
          types: rows.map((r) => r.content_type).filter(Boolean),
        });
      }
      const union = buildChunkUnionQuery(await getChunkSchemas(), (schema) => ({
        sql: `SELECT DISTINCT content_type FROM ${schema}.chunks`,
        params: [],
      }));

      if (union === null) {
        return h.response({ types: [] });
      }
      const { rows } = await pool.query<{ content_type: string }>(
        union.sql,
        union.params,
      );

      return h.response({
        types: [...new Set(rows.map((r) => r.content_type).filter(Boolean))],
      });
    },
  };
}

function chunkSummaryRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/chunk-summary",
    options: zodResponse(bearerScope("read"), ChunkSummarySchema, {
      name: "RepoChunkSummary",
      description: "How much context a repo has ingested",
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const repo = `${request.params.owner}/${request.params.repo}`;
      const { repoSchema } = schemaReaders(pool);
      const schema = await repoSchema(repo);

      const { rows: countRows } = await pool.query<{ count: number }>(
        `SELECT count(*)::int as count FROM ${schema}.chunks WHERE repo = $1`,
        [repo],
      );
      const { rows: conventionRows } = await pool.query<{
        file_path: string;
      }>(
        `SELECT DISTINCT file_path FROM ${schema}.chunks
          WHERE repo = $1 AND file_path IN ('AGENTS.md','CLAUDE.md')`,
        [repo],
      );

      return h.response({
        count: countRows[0]?.count ?? 0,
        convention_files: conventionRows.map((r) => r.file_path),
      });
    },
  };
}

function chunksByPathRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/chunks/by-path",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ByPathQuery) },
      },
      ChunkByPathSchema,
      {
        name: "ChunkByPath",
        description: "Every chunk ingested from one file",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const { path, repo } = request.query as unknown as ByPathQuery;
      const { getChunkSchemas, repoSchema } = schemaReaders(pool);

      if (repo) {
        const schema = await repoSchema(repo);
        const { rows } = await pool.query(
          `SELECT id, content_type, content, metadata, repo
             FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
          [path, repo],
        );

        return h.response({ chunks: rows });
      }
      // File path unique per repo, but global view spans all schemas; caller groups by repo.
      const union = buildChunkUnionQuery(
        await getChunkSchemas(),
        (schema, offset) => ({
          sql: `SELECT id, content_type, content, metadata, repo
                  FROM ${schema}.chunks WHERE file_path = $${offset}`,
          params: [path],
        }),
      );

      if (union === null) {
        return h.response({ chunks: [] });
      }
      const { rows } = await pool.query(union.sql, union.params);

      return h.response({ chunks: rows });
    },
  };
}
