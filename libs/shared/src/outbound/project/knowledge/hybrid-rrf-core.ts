// RRF_DAMPING is shared; each caller builds its own SQL (different columns, filters, HNSW sub-query).

/** RRF damping constant (Cormack & Clarke, 2009). Re-evaluating it is out of scope. */
export const RRF_DAMPING = 60;

/** Corpus search across the whole schema — $1=embedding, $2=keyword terms, $3=LIMIT. */
export function buildHybridCorpusOrgWideSQL(schema: string): string {
  return buildCorpusSQL(schema, ``, ``);
}

/** Corpus search scoped to one repo — $1=embedding, $2=keyword terms, $3=LIMIT, $4=repo. */
export function buildHybridCorpusBoundSQL(schema: string): string {
  return buildCorpusSQL(schema, `WHERE repo = $4`, `AND repo = $4`);
}

// eslint-disable-next-line max-lines-per-function -- one SQL statement returned whole: the two CTEs and the RRF join are read together as a query, and cutting them into string fragments would hide the join they exist for
function buildCorpusSQL(
  schema: string,
  repoFilter: string,
  kwRepoFilter: string,
): string {
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
