export const dynamic = "force-dynamic";
import { query, queryAllChunks } from "@/lib/db";
import SearchView, {
  type SearchResult,
  type SearchRepoOption,
} from "./SearchView";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; repo?: string }>;
}) {
  const { q, repo } = await searchParams;
  let results: SearchResult[] = [];

  // Populate repo filter dropdown
  const repos = await query<SearchRepoOption>(
    `SELECT full_name FROM lore.repos ORDER BY full_name`,
  );

  if (q) {
    // Search memories using inline to_tsvector (no generated column on memory.memories)
    const memoryResults = await query<SearchResult>(
      `
      SELECT key, substring(value, 1, 300) as value, agent_id,
             ts_rank(to_tsvector('english', value), plainto_tsquery($1)) as score,
             'memory' as source,
             NULL as repo
      FROM memory.memories
      WHERE is_deleted = FALSE
        AND (expires_at IS NULL OR expires_at > now())
        AND to_tsvector('english', value) @@ plainto_tsquery($1)
      ORDER BY score DESC
      LIMIT 20
    `,
      [q],
    );

    // Search facts table (includes episode-derived facts, excludes invalidated by default)
    const factResults = await query<SearchResult>(
      `
      SELECT COALESCE(m.key, e.source || ':' || COALESCE(e.ref, e.id::text)) as key,
             substring(f.fact_text, 1, 300) as value,
             COALESCE(m.agent_id, e.agent_id) as agent_id,
             ts_rank(to_tsvector('english', f.fact_text), plainto_tsquery($1)) as score,
             CASE WHEN f.episode_id IS NOT NULL THEN 'episode' ELSE 'fact' END as source,
             NULL as repo
      FROM memory.facts f
      LEFT JOIN memory.memories m ON m.id = f.memory_id
      LEFT JOIN memory.episodes e ON e.id = f.episode_id
      WHERE (m.id IS NULL OR (m.is_deleted = FALSE AND (m.expires_at IS NULL OR m.expires_at > now())))
        AND f.valid_to IS NULL
        AND to_tsvector('english', f.fact_text) @@ plainto_tsquery($1)
      ORDER BY score DESC
      LIMIT 20
    `,
      [q],
    );

    // Search repo chunks across all schemas (scoped by repo if filtered)
    const chunkResults = await queryAllChunks<SearchResult>(
      (schema, offset) => {
        const repoFilter = repo ? `AND c.repo = $${offset + 1}` : "";

        return {
          sql: `SELECT c.file_path as key, substring(c.content, 1, 300) as value,
                       'ingestion' as agent_id,
                       ts_rank(to_tsvector('english', c.content), plainto_tsquery($${offset})) as score,
                       'chunk' as source,
                       c.repo as repo
                FROM ${schema}.chunks c
                WHERE to_tsvector('english', c.content) @@ plainto_tsquery($${offset})
                  ${repoFilter}`,
          params: repo ? [q, repo] : [q],
        };
      },
    );

    chunkResults.sort((a, b) => b.score - a.score);
    chunkResults.splice(20);

    // Merge and sort by score descending, capped at 30
    const allResults = [...memoryResults, ...factResults, ...chunkResults];

    results = allResults.sort((a, b) => b.score - a.score).slice(0, 30);
  }

  return <SearchView q={q} repo={repo} repos={repos} results={results} />;
}
