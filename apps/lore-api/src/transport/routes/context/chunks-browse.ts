import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { buildChunkUnionQuery } from "../../../work/chunks/chunk-union.js";
import {
  ByPathQuery,
  ChunkByPathSchema,
  ChunkListSchema,
  ChunkSummarySchema,
  ChunkTypeListSchema,
  ChunksQuery,
} from "./chunks-browse-schemas.js";
import { schemaReaders } from "./chunk-schema-readers.js";
import { withPool } from "../with-pool.js";

/** Context browser chunk reads via schema union (ADR-032); queries per-team schemas + org_shared. */

export function chunkBrowseRoutes(getPool: () => Pool | null): ServerRoute[] {
  return [
    listChunksRoute(getPool),
    chunkTypesRoute(getPool),
    chunkSummaryRoute(getPool),
    chunksByPathRoute(getPool),
  ];
}

interface ChunkPage {
  repo: string;
  type?: string;
  q?: string;
  orderBy: string;
  pageSize: number;
  offset: number;
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
      const query = request.query as unknown as ChunksQuery;

      return h.response({ chunks: await readChunkPage(pool, query) });
    },
  };
}

/** A page of chunks: from ONE repo's team schema when a repo is named, else unioned across every team schema. Reads limit+1 rows so the caller can tell there is another page without paying for a COUNT, and orders by rank only when there is a query to rank against. */
async function readChunkPage(pool: Pool, query: ChunksQuery) {
  const { repo, type, q, limit, offset } = query;
  const { getChunkSchemas, repoSchema } = schemaReaders(pool);
  const pageSize = limit + 1;
  const orderBy = q ? "rank DESC, id DESC" : "ingested_at DESC, id DESC";

  if (repo) {
    return readRepoChunks(pool, await repoSchema(repo), {
      repo,
      type,
      q,
      orderBy,
      pageSize,
      offset,
    });
  }

  return readUnionChunks(pool, await getChunkSchemas(), chunkSelect(type, q), {
    orderBy,
    limit: pageSize,
  });
}

/** One repo's chunks read from its own schema — no union needed, so this path skips the cross-schema query entirely. */
async function readRepoChunks(
  pool: Pool,
  schema: string,
  page: ChunkPage,
): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(repoChunkSql(schema, page), [
    page.repo,
    page.type || null,
    page.q || null,
  ]);

  return rows;
}

function repoChunkSql(schema: string, page: ChunkPage): string {
  return `SELECT id, file_path, content_type, repo, metadata,
                  substring(content, 1, 300) as content, ingested_at,
                  CASE WHEN $3::text IS NULL THEN 0
                       ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $3)) END as rank
             FROM ${schema}.chunks
            WHERE repo = $1
              AND ($2::text IS NULL OR content_type = $2)
              AND ($3::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $3))
            ORDER BY ${page.orderBy}
            LIMIT ${page.pageSize} OFFSET ${page.offset}`;
}

/** Every team schema at once, for a browse with no repo selected. A deployment with no chunk schemas yet returns nothing rather than failing. */
async function readUnionChunks(
  pool: Pool,
  schemas: string[],
  select: Parameters<typeof buildChunkUnionQuery>[1],
  page: { orderBy: string; limit: number },
): Promise<Record<string, unknown>[]> {
  const union = buildChunkUnionQuery(schemas, select, [], page);

  if (union === null) {
    return [];
  }
  const { rows } = await pool.query(union.sql, union.params);

  return rows;
}

/** One schema's SELECT. `$n`/`$n+1` are the type and query params — the union read repeats this per schema with a shifted offset, so the placeholders are positional rather than named. The content column is truncated to 300 chars: this is a browse view, not a fetch. */
function chunkSelect(type: string | undefined, q: string | undefined) {
  return (schema: string, offset: number) => ({
    sql: `SELECT id, file_path, content_type, repo, metadata,
                     substring(content, 1, 300) as content, ingested_at,
                     CASE WHEN $${offset + 1}::text IS NULL THEN 0
                          ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $${offset + 1})) END as rank
                FROM ${schema}.chunks
               WHERE ($${offset}::text IS NULL OR content_type = $${offset})
                 AND ($${offset + 1}::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $${offset + 1}))`,
    params: [type || null, q || null],
  });
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

      return h.response({ types: await readChunkTypes(pool, repo) });
    },
  };
}

/** The content types in scope. Deliberately NOT filtered by the current selection: these drive the filter chips, and a chip that disappears when you select it cannot be unselected. */
async function readChunkTypes(pool: Pool, repo?: string): Promise<string[]> {
  const { getChunkSchemas, repoSchema } = schemaReaders(pool);

  if (repo) {
    const { rows } = await pool.query<{ content_type: string }>(
      `SELECT DISTINCT content_type FROM ${await repoSchema(repo)}.chunks WHERE repo = $1`,
      [repo],
    );

    return rows.map((r) => r.content_type).filter(Boolean);
  }

  return readUnionChunkTypes(pool, await getChunkSchemas());
}

/** The content types across every team schema at once, de-duplicated. */
async function readUnionChunkTypes(
  pool: Pool,
  schemas: string[],
): Promise<string[]> {
  const union = buildChunkUnionQuery(schemas, (schema) => ({
    sql: `SELECT DISTINCT content_type FROM ${schema}.chunks`,
    params: [],
  }));

  if (union === null) {
    return [];
  }
  const { rows } = await pool.query<{ content_type: string }>(
    union.sql,
    union.params,
  );

  return [...new Set(rows.map((r) => r.content_type).filter(Boolean))];
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

      return h.response(
        await readChunkSummary(
          pool,
          `${request.params.owner}/${request.params.repo}`,
        ),
      );
    },
  };
}

/** How much context a repo has ingested. The convention files are named explicitly rather than counted: their PRESENCE is what tells a reader whether this repo was onboarded properly, and a count of 400 chunks says nothing about that. */
async function readChunkSummary(
  pool: Pool,
  repo: string,
): Promise<{ count: number; convention_files: string[] }> {
  const schema = await schemaReaders(pool).repoSchema(repo);
  const { rows: countRows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int as count FROM ${schema}.chunks WHERE repo = $1`,
    [repo],
  );
  const { rows: conventionRows } = await pool.query<{ file_path: string }>(
    `SELECT DISTINCT file_path FROM ${schema}.chunks
          WHERE repo = $1 AND file_path IN ('AGENTS.md','CLAUDE.md')`,
    [repo],
  );

  return {
    count: countRows[0]?.count ?? 0,
    convention_files: conventionRows.map((r) => r.file_path),
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
    handler: withPool(getPool, serveChunksByPath),
  };
}

async function serveChunksByPath(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { path, repo } = request.query as unknown as ByPathQuery;

  return h.response({ chunks: await readChunksByPath(pool, path, repo) });
}

/** Every chunk ingested from one file. A file path is unique per repo but NOT across them, so the global view spans all schemas and returns the repo on each row for the caller to group by. */
async function readChunksByPath(
  pool: Pool,
  path: string,
  repo?: string,
): Promise<unknown[]> {
  const { getChunkSchemas, repoSchema } = schemaReaders(pool);

  if (repo) {
    const { rows } = await pool.query(
      `SELECT id, content_type, content, metadata, repo
             FROM ${await repoSchema(repo)}.chunks WHERE file_path = $1 AND repo = $2`,
      [path, repo],
    );

    return rows;
  }

  return readUnionChunksByPath(pool, await getChunkSchemas(), path);
}

/** One file path read across every team schema — the path is unique per repo but not across them. */
async function readUnionChunksByPath(
  pool: Pool,
  schemas: string[],
  path: string,
): Promise<unknown[]> {
  const union = buildChunkUnionQuery(schemas, (schema, offset) => ({
    sql: `SELECT id, content_type, content, metadata, repo
                  FROM ${schema}.chunks WHERE file_path = $${offset}`,
    params: [path],
  }));

  if (union === null) {
    return [];
  }
  const { rows } = await pool.query(union.sql, union.params);

  return rows;
}
