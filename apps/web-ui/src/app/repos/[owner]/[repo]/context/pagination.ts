export const CONTEXT_PAGE_SIZE = 50;

export interface ContextChunkQuery {
  sql: string;
  params: (string | number | null)[];
}

/**
 * Builds the per-repo context-list query, shared by the server page (offset 0)
 * and the Load-more API route. Fetches one row past the page size from `offset`
 * so callers can detect a further page from the returned row count alone — no
 * separate COUNT query.
 */
export function contextChunkQuery(
  schema: string,
  repo: string,
  type: string | undefined,
  q: string | undefined,
  offset: number,
): ContextChunkQuery {
  return {
    sql: `SELECT id, file_path, content_type, metadata,
                 substring(content, 1, 500) as content, ingested_at
          FROM ${schema}.chunks
          WHERE repo = $1
            AND ($2::text IS NULL OR content_type = $2)
            AND ($3::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $3))
          ORDER BY
            CASE WHEN $3::text IS NULL THEN 0
                 ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $3)) END DESC,
            content_type, file_path
          LIMIT $4 OFFSET $5`,
    params: [repo, type || null, q || null, CONTEXT_PAGE_SIZE + 1, offset],
  };
}
