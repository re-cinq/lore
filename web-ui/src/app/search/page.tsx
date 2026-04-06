export const dynamic = "force-dynamic";
import { query, queryAllChunks } from '@/lib/db';

interface SearchResult {
  key: string;
  value: string;
  agent_id: string;
  score: number;
  source: 'memory' | 'fact' | 'chunk' | 'episode';
  repo: string | null;
}

interface Repo {
  full_name: string;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; repo?: string }> }) {
  const { q, repo } = await searchParams;
  let results: SearchResult[] = [];

  // Populate repo filter dropdown
  const repos = await query<Repo>(`SELECT full_name FROM lore.repos ORDER BY full_name`);

  if (q) {
    // Search memories using inline to_tsvector (no generated column on memory.memories)
    const memoryResults = await query<SearchResult>(`
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
    `, [q]);

    // Search facts table (includes episode-derived facts, excludes invalidated by default)
    const factResults = await query<SearchResult>(`
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
    `, [q]);

    // Search repo chunks across all schemas (scoped by repo if filtered)
    const chunkResults = await queryAllChunks<SearchResult>(
      (schema, offset) => {
        const repoFilter = repo ? `AND c.repo = $${offset + 1}` : '';
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

    // Merge and sort by score descending
    const allResults = [...memoryResults, ...factResults, ...chunkResults];

    // If repo filter is active, only include chunk results (scoped) plus memories/facts
    if (repo) {
      results = allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);
    } else {
      results = allResults
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);
    }
  }

  return (
    <div>
      <h1>Search Memories</h1>
      <form method="get" className="search-form">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
          <select name="repo" defaultValue={repo || ''} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}>
            <option value="">All repos</option>
            {repos.map(r => (
              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        </div>
        <input type="text" name="q" defaultValue={q || ''} placeholder="Search across all agent memories, facts, and repo chunks..." />
        <button type="submit">Search</button>
      </form>
      {q && (
        <p className="meta" style={{ marginBottom: 16 }}>
          {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{q}&quot;
          {repo && <> in <strong>{repo}</strong></>}
        </p>
      )}
      {results.map((r, i) => (
        <div key={i} className="search-result">
          <div className="result-header">
            <strong>{r.key}</strong>
            <span className="meta">
              agent: {r.agent_id.substring(0, 8)}... · score: {r.score.toFixed(3)}
              {r.repo && <> · repo: <strong>{r.repo}</strong></>}
            </span>
          </div>
          <pre>{r.value}</pre>
          <div className="result-source">
            source: <span className={`op-badge ${r.source === 'fact' ? 'op-search' : r.source === 'chunk' ? 'op-write' : 'op-read'}`}>{r.source}</span>
            {r.repo && <span className="badge" style={{ marginLeft: '0.5rem' }}>{r.repo}</span>}
          </div>
        </div>
      ))}
      {q && results.length === 0 && (
        <div className="empty-state">
          <p>No results found. Try a different search term.</p>
        </div>
      )}
    </div>
  );
}
