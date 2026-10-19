import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** PostgreSQL + pgvector search using Reciprocal Rank Fusion (RRF) for vector + keyword. */

import type { Pool } from "pg";
import {
  getQueryEmbedding,
  embeddingHealth,
  embedderDegraded,
} from "@re-cinq/lore-shared";
import { chunkSchemaOrOrgShared } from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
import { extractKeyTerms } from "@re-cinq/lore-shared/project/knowledge/context-assembly-items.js";
import { buildHybridCorpusSQL } from "@re-cinq/lore-shared/project/knowledge/hybrid-rrf-core.js";

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
  repo?: string,
): Promise<SearchResult[]> {
  if (!(await isDbAvailable())) {
    return [];
  }
  const resolved = await chunkSchemaOrOrgShared(getPool(), schema);
  const embedding = await getQueryEmbedding(query);
  const keywordQuery = extractKeyTerms(query).join(" OR ") || query;

  return embedding
    ? runHybridSQL({ embedding, keywordQuery, schema: resolved, limit, repo })
    : keywordOnlySearch(query, resolved, limit, repo);
}

async function runHybridSQL(options: {
  embedding: number[];
  keywordQuery: string;
  schema: string;
  limit: number;
  repo?: string;
}): Promise<SearchResult[]> {
  const { embedding, keywordQuery, schema, limit, repo } = options;
  const embeddingStr = `[${embedding.join(",")}]`;
  const sql = buildHybridCorpusSQL(schema, repo !== undefined);
  const params: unknown[] = [embeddingStr, keywordQuery, limit];

  if (repo) {
    params.push(repo);
  }
  const { rows } = await getPool().query(sql, params);

  return normalizeSearchScores(rows as SearchResult[]);
}

// Keyword-only, for when no embedding could be obtained. Degraded rather than empty: a repo whose embeddings are unavailable still answers a search, and the caller cannot tell the difference except in ranking.
async function keywordOnlySearch(
  query: string,
  schema: string,
  limit: number,
  repo?: string,
): Promise<SearchResult[]> {
  const params: unknown[] = repo ? [query, limit, repo] : [query, limit];
  const { rows } = await getPool().query(
    `
      SELECT id, content, metadata,
             ts_rank(search_tsv, plainto_tsquery($1)) AS rrf_score
      FROM ${schema}.chunks
      WHERE search_tsv @@ plainto_tsquery($1) ${repo ? "AND repo = $3" : ""}
      ORDER BY rrf_score DESC
      LIMIT $2;`,
    params,
  );

  return rows as SearchResult[];
}

function normalizeSearchScores(rows: SearchResult[]): SearchResult[] {
  const max = Math.max(0, ...rows.map((r) => r.rrf_score));

  if (max <= 0) {
    return rows;
  }

  return rows.map((r) => ({ ...r, rrf_score: r.rrf_score / max }));
}
