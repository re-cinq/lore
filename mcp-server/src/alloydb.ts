/**
 * AlloyDB-backed search module for Phase 1 queries.
 *
 * Uses Reciprocal Rank Fusion (RRF) to combine vector and keyword search.
 * Degrades gracefully when AlloyDB is unavailable.
 */

// Placeholder: in production, import a configured pg Pool from a config module.
// import { pool } from './config';

let pool: any = null;

export function setPool(pgPool: any): void {
  pool = pgPool;
}

// ── Health check ──────────────────────────────────────────────────────

export async function isAlloyDbAvailable(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
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

const HYBRID_SEARCH_SQL = `
WITH vector_results AS (
  SELECT id, content, metadata,
         ROW_NUMBER() OVER (
           ORDER BY embedding <=> embedding('text-embedding-005', $1)::vector
         ) AS vector_rank
  FROM $2:name.documents
  LIMIT $3
),
keyword_results AS (
  SELECT id, content, metadata,
         ROW_NUMBER() OVER (
           ORDER BY ts_rank(search_tsv, plainto_tsquery($1)) DESC
         ) AS keyword_rank
  FROM $2:name.documents
  WHERE search_tsv @@ plainto_tsquery($1)
  LIMIT $3
)
SELECT
  COALESCE(v.id, k.id) AS id,
  COALESCE(v.content, k.content) AS content,
  COALESCE(v.metadata, k.metadata) AS metadata,
  (
    COALESCE(1.0 / (60 + v.vector_rank), 0) +
    COALESCE(1.0 / (60 + k.keyword_rank), 0)
  ) AS rrf_score
FROM vector_results v
FULL OUTER JOIN keyword_results k ON v.id = k.id
ORDER BY rrf_score DESC
LIMIT $3;
`;

export async function hybridSearch(
  query: string,
  schema: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  if (!(await isAlloyDbAvailable())) return [];

  const { rows } = await pool.query(HYBRID_SEARCH_SQL, [query, schema, limit]);
  return rows as SearchResult[];
}

// ── Team context docs ────────────────────────────────────────────────

const CONTEXT_DOC_SQL = `
SELECT id, content, content_type, metadata
FROM $1:name.documents
WHERE content_type = 'doc'
UNION ALL
SELECT id, content, content_type, metadata
FROM org_shared.documents
WHERE content_type = 'doc'
ORDER BY id;
`;

export async function getContextFromDb(team: string): Promise<DocResult[]> {
  if (!(await isAlloyDbAvailable())) return [];

  const { rows } = await pool.query(CONTEXT_DOC_SQL, [team]);
  return rows as DocResult[];
}

// ── ADR lookup ───────────────────────────────────────────────────────

const ADR_SQL = `
SELECT id, content, metadata->>'domain' AS domain, metadata->>'status' AS status, metadata
FROM org_shared.documents
WHERE content_type = 'adr'
  AND (metadata->>'domain' = $1 OR $1 IS NULL)
  AND (metadata->>'status' = $2 OR $2 IS NULL)
ORDER BY id;
`;

export async function getAdrsFromDb(
  domain: string,
  status: string,
): Promise<AdrResult[]> {
  if (!(await isAlloyDbAvailable())) return [];

  const { rows } = await pool.query(ADR_SQL, [domain || null, status || null]);
  return rows as AdrResult[];
}

// ── File PR history ──────────────────────────────────────────────────

const FILE_PR_HISTORY_SQL = `
SELECT id, content, $1 AS file_path, metadata
FROM org_shared.documents
WHERE content_type = 'pull_request'
  AND metadata->'files_changed' ? $1
ORDER BY id DESC;
`;

export async function getFilePrHistory(
  filePath: string,
): Promise<PrHistoryResult[]> {
  if (!(await isAlloyDbAvailable())) return [];

  const { rows } = await pool.query(FILE_PR_HISTORY_SQL, [filePath]);
  return rows as PrHistoryResult[];
}
