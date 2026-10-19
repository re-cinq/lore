/**
 * Shared core for hybrid Reciprocal Rank Fusion (RRF) retrieval.
 *
 * Two callers use this module:
 *   - `hybridSearch` (libs/server-core/src/outbound/db.ts): corpus search,
 *     schema-wide or org_shared, no content-type filter, returns raw id/content/metadata rows.
 *   - `hybridChunkSearch` (context-assembly-chunk-search.ts): repo-scoped assembly search,
 *     filters by content_type, selects SourceItem columns (file_path, similarity, content_hash),
 *     and uses the HNSW sub-query optimisation — so it builds its own SQL legs with this constant.
 *
 * Centralising RRF_DAMPING here means both callers stay consistent with the damping factor
 * without a silent numeric divergence.
 */

/** RRF damping constant (Cormack & Clarke, 2009). Re-evaluating it is out of scope. */
export const RRF_DAMPING = 60;

/**
 * Builds the hybrid RRF SQL for corpus search: two CTEs (vector + keyword) fused with a
 * FULL OUTER JOIN, no content-type filter.
 *
 * Parameters in the returned SQL:
 *   $1  — embedding vector string (e.g. '[0.1,0.2,…]::vector')
 *   $2  — keyword query string (already extracted key terms, OR-joined)
 *   $3  — LIMIT
 *   $4  — repo name (only present when repoBound is true)
 */
// eslint-disable-next-line max-lines-per-function -- one SQL statement returned whole: the two CTEs and the RRF join are read together as a query, and cutting them into string fragments would hide the join they exist for
export function buildHybridCorpusSQL(
  schema: string,
  repoBound: boolean,
): string {
  const repoFilter = repoBound ? `WHERE repo = $4` : ``;
  const kwRepoFilter = repoBound ? `AND repo = $4` : ``;

  return `
WITH vector_results AS (
  SELECT id, content, metadata,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS vec_rank
  FROM ${schema}.chunks
  ${repoFilter}
  LIMIT 20
),
keyword_results AS (
  SELECT id, content, metadata,
         ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, websearch_to_tsquery('english', $2)) DESC) AS kw_rank
  FROM ${schema}.chunks
  WHERE search_tsv @@ websearch_to_tsquery('english', $2) ${kwRepoFilter}
  LIMIT 20
)
SELECT
  COALESCE(v.id, k.id) AS id,
  COALESCE(v.content, k.content) AS content,
  COALESCE(v.metadata, k.metadata) AS metadata,
  (COALESCE(1.0 / (${RRF_DAMPING} + v.vec_rank), 0) + COALESCE(1.0 / (${RRF_DAMPING} + k.kw_rank), 0)) AS rrf_score
FROM vector_results v
FULL OUTER JOIN keyword_results k ON v.id = k.id
ORDER BY rrf_score DESC
LIMIT $3;`;
}
