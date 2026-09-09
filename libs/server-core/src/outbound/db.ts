import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** PostgreSQL + pgvector search using Reciprocal Rank Fusion (RRF) for vector + keyword. */

import type { Pool } from "pg";
import {
  getQueryEmbedding,
  embeddingHealth,
  embedderDegraded,
} from "@re-cinq/lore-shared";
import { chunkSchemaOrOrgShared } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";

// Re-exported from shared embedding-service singleton for back-compat.
export { getQueryEmbedding, embeddingHealth, embedderDegraded };

let pool: Pool | null = null;

export function getPool(): Pool {
  enforceTrue(pool, Error, "Database not configured");

  return pool;
}

export function setPool(pgPool: Pool): void {
  pool = pgPool;
}

// ── Health check ──────────────────────────────────────────────────────

export async function isDbAvailable(): Promise<boolean> {
  if (!pool) {
    return false;
  }

  try {
    await pool.query("SELECT 1");

    return true;
  } catch {
    return false;
  }
}

// Not an error: file-backed mode is a supported way to run, so health says why there is no database rather than reporting a failure to reach one.
const NO_DATABASE = {
  connected: false,
  chunk_count: null,
  reason: "no database configured (file-backed mode)",
};

export async function getHealthStatus(): Promise<{
  connected: boolean;
  chunk_count: number | null;
  reason?: string;
}> {
  if (!pool) {
    return NO_DATABASE;
  }

  try {
    await pool.query("SELECT 1");
    const { rows } = await pool.query(
      "SELECT count(*)::int AS cnt FROM org_shared.chunks",
    );

    return { connected: true, chunk_count: rows[0].cnt };
  } catch {
    return { connected: false, chunk_count: null, reason: "connection failed" };
  }
}

// ── Result types ──────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  rrf_score: number;
}

// ── Hybrid search (RRF) ──────────────────────────────────────────────

export async function hybridSearch(
  query: string,
  schema: string,
  limit: number = 8,
): Promise<SearchResult[]> {
  if (!(await isDbAvailable())) {
    return [];
  }

  // Unknown schema falls back to org_shared; provisioned team schemas read directly.
  const resolvedSchema = await chunkSchemaOrOrgShared(getPool(), schema);

  // Get query embedding from Vertex AI
  const embedding = await getQueryEmbedding(query);

  if (!embedding) {
    return keywordOnlySearch(query, resolvedSchema, limit);
  }

  // Full hybrid search (vector + keyword)
  const embeddingStr = `[${embedding.join(",")}]`;
  const sql = buildHybridSearchSQL(resolvedSchema);
  const { rows } = await getPool().query(sql, [embeddingStr, query, limit]);

  return rows as SearchResult[];
}

// Keyword-only, for when no embedding could be obtained. Degraded rather than empty: a repo whose embeddings are unavailable still answers a search, and the caller cannot tell the difference except in ranking.
async function keywordOnlySearch(
  query: string,
  schema: string,
  limit: number,
): Promise<SearchResult[]> {
  const { rows } = await getPool().query(
    `
      SELECT id, content, metadata,
             ts_rank(search_tsv, plainto_tsquery($1)) AS rrf_score
      FROM ${schema}.chunks
      WHERE search_tsv @@ plainto_tsquery($1)
      ORDER BY rrf_score DESC
      LIMIT $2;`,
    [query, limit],
  );

  return rows as SearchResult[];
}

// eslint-disable-next-line max-lines-per-function -- one SQL statement, returned whole: the two CTEs and the RRF join are read together as a query, and cutting them into string fragments would hide the join they exist for
function buildHybridSearchSQL(schema: string): string {
  return `
WITH vector_results AS (
  SELECT id, content, metadata,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS vec_rank
  FROM ${schema}.chunks
  LIMIT 20
),
keyword_results AS (
  SELECT id, content, metadata,
         ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, plainto_tsquery($2)) DESC) AS kw_rank
  FROM ${schema}.chunks
  WHERE search_tsv @@ plainto_tsquery($2)
  LIMIT 20
)
SELECT
  COALESCE(v.id, k.id) AS id,
  COALESCE(v.content, k.content) AS content,
  COALESCE(v.metadata, k.metadata) AS metadata,
  (COALESCE(1.0 / (60 + v.vec_rank), 0) + COALESCE(1.0 / (60 + k.kw_rank), 0)) AS rrf_score
FROM vector_results v
FULL OUTER JOIN keyword_results k ON v.id = k.id
ORDER BY rrf_score DESC
LIMIT $3;`;
}
