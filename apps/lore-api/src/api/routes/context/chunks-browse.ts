import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
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

/**
 * The context browser's chunk reads, moved out of web-ui together with the
 * schema-union machinery they depend on (ADR-032). This is what lets web-ui stop
 * holding a Postgres pool at all.
 *
 * Chunks are stored per TEAM schema plus `org_shared`, so a global read is a
 * UNION ALL across every provisioned schema and a repo-scoped read is a single
 * schema resolved from that repo's team. Getting the set wrong does not error —
 * it silently shows another team's chunks, or none — which is why the catalog is
 * the source of truth rather than `lore.repos.team`, a free-text column that can
 * name a schema nobody ever provisioned.
 */

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

export function chunkBrowseRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    {
      method: "GET",
      path: "/api/chunks",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(ChunksQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { repo, type, q, limit, offset } =
          request.query as unknown as ChunksQuery;
        const { getChunkSchemas, repoSchema } = schemaReaders(pool);

        // One past the page size, so a caller detects a further page without a
        // second COUNT over every schema.
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

        const union = buildChunkUnionQuery(
          await getChunkSchemas(),
          select,
          [],
          { orderBy, limit: pageSize },
        );

        if (union === null) {
          return h.response({ chunks: [] });
        }
        const { rows } = await pool.query(union.sql, union.params);

        return h.response({ chunks: rows });
      },
    },

    {
      method: "GET",
      path: "/api/chunk-types",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(ChunksQuery.pick({ repo: true })) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
        const { repo } = request.query as { repo?: string };
        const { getChunkSchemas, repoSchema } = schemaReaders(pool);

        // The chip set is data-driven and deliberately UNFILTERED by the active
        // type/search, so a chip never disappears the moment it is selected.
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
        const union = buildChunkUnionQuery(
          await getChunkSchemas(),
          (schema) => ({
            sql: `SELECT DISTINCT content_type FROM ${schema}.chunks`,
            params: [],
          }),
        );

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
    },

    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/chunk-summary",
      options: bearerScope("read"),
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
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
    },

    {
      method: "GET",
      path: "/api/chunks/by-path",
      options: {
        ...bearerScope("read"),
        validate: { query: zodValidate(ByPathQuery) },
      },
      handler: async (request, h) => {
        const pool = getPool();

        if (!pool) {
          return h.response({ error: DB_UNAVAILABLE }).code(503);
        }
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
        // A file path is normally unique to one repo, but the global view spans
        // every team schema — the caller groups by repo.
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
    },
  ];
}
