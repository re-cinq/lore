import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * PostgreSQL + pgvector search module.
 *
 * Uses Reciprocal Rank Fusion (RRF) to combine vector and keyword search.
 * Calls Vertex AI text-embedding-005 for query embeddings (no AlloyDB
 * embedding() function — we're running CNPG, not managed AlloyDB).
 * Degrades gracefully when PostgreSQL is unavailable.
 */

import type { Pool } from "pg";
import { getQueryEmbedding } from "@re-cinq/lore-shared";

// Vertex AI query embeddings now live in the shared embedding-service singleton;
// re-exported here for back-compat with this module's existing importers.
export { getQueryEmbedding };

let pool: Pool | null = null;

// Schema allow-list to prevent SQL injection
const VALID_SCHEMAS = new Set([
  "org_shared",
  "payments",
  "platform",
  "mobile",
  "data",
]);

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

export async function getHealthStatus(): Promise<{
  connected: boolean;
  chunk_count: number | null;
  reason?: string;
}> {
  if (!pool) {
    return {
      connected: false,
      chunk_count: null,
      reason: "no database configured (file-backed mode)",
    };
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

export interface DocResult {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
}

export interface AdrResult {
  id: string;
  content: string;
  domain: string;
  status: string;
  metadata: Record<string, unknown>;
}

export interface PrHistoryResult {
  id: string;
  content: string;
  file_path: string;
  metadata: Record<string, unknown>;
}

// ── Hybrid search (RRF) ──────────────────────────────────────────────

function buildHybridSearchSQL(schema: string): string {
  if (!VALID_SCHEMAS.has(schema)) {
    schema = "org_shared";
  }

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

export async function hybridSearch(
  query: string,
  schema: string,
  limit: number = 8,
): Promise<SearchResult[]> {
  if (!(await isDbAvailable())) {
    return [];
  }

  // Get query embedding from Vertex AI
  const embedding = await getQueryEmbedding(query);

  if (embedding) {
    // Full hybrid search (vector + keyword)
    const embeddingStr = `[${embedding.join(",")}]`;
    const sql = buildHybridSearchSQL(schema);
    const { rows } = await getPool().query(sql, [embeddingStr, query, limit]);

    return rows as SearchResult[];
  } else {
    // Fallback: keyword-only search (no embedding available)
    if (!VALID_SCHEMAS.has(schema)) {
      schema = "org_shared";
    }
    const sql = `
      SELECT id, content, metadata,
             ts_rank(search_tsv, plainto_tsquery($1)) AS rrf_score
      FROM ${schema}.chunks
      WHERE search_tsv @@ plainto_tsquery($1)
      ORDER BY rrf_score DESC
      LIMIT $2;`;
    const { rows } = await getPool().query(sql, [query, limit]);

    return rows as SearchResult[];
  }
}

// ── Team context docs ────────────────────────────────────────────────

export async function getContextFromDb(team: string): Promise<DocResult[]> {
  if (!(await isDbAvailable())) {
    return [];
  }

  if (!VALID_SCHEMAS.has(team)) {
    team = "org_shared";
  }

  const sql = `
    SELECT id, content, content_type, metadata
    FROM ${team}.chunks
    WHERE content_type IN ('doc')
    UNION ALL
    SELECT id, content, content_type, metadata
    FROM org_shared.chunks
    WHERE content_type IN ('doc')
    ${team !== "org_shared" ? "" : "AND FALSE"}
    ORDER BY 1;`;
  const { rows } = await getPool().query(sql);

  return rows as DocResult[];
}

// ── ADR lookup ───────────────────────────────────────────────────────

export async function getAdrsFromDb(
  domain: string,
  status: string,
): Promise<AdrResult[]> {
  if (!(await isDbAvailable())) {
    return [];
  }

  const sql = `
    SELECT id, content, metadata->>'domain' AS domain, metadata->>'status' AS status, metadata
    FROM org_shared.chunks
    WHERE content_type = 'adr'
      AND ($1 = '' OR content ILIKE '%' || $1 || '%')
      AND ($2 = '' OR content ILIKE '%' || $2 || '%')
    ORDER BY 1;`;
  const { rows } = await getPool().query(sql, [domain, status]);

  return rows as AdrResult[];
}

// ── File PR history ──────────────────────────────────────────────────

export async function getFilePrHistory(
  filePath: string,
): Promise<PrHistoryResult[]> {
  if (!(await isDbAvailable())) {
    return [];
  }

  const sql = `
    SELECT id, content, $1 AS file_path, metadata
    FROM org_shared.chunks
    WHERE content_type = 'pull_request'
      AND metadata->>'file_path' ILIKE '%' || $1 || '%'
    ORDER BY 1 DESC;`;
  const { rows } = await getPool().query(sql, [filePath]);

  return rows as PrHistoryResult[];
}
