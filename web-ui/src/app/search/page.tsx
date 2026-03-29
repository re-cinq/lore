export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface SearchResult {
  key: string;
  value: string;
  agent_id: string;
  score: number;
  source: 'memory' | 'fact';
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  let results: SearchResult[] = [];

  if (q) {
    // Search memories using inline to_tsvector (no generated column on memory.memories)
    const memoryResults = await query<SearchResult>(`
      SELECT key, substring(value, 1, 300) as value, agent_id,
             ts_rank(to_tsvector('english', value), plainto_tsquery($1)) as score,
             'memory' as source
      FROM memory.memories
      WHERE is_deleted = FALSE
        AND (expires_at IS NULL OR expires_at > now())
        AND to_tsvector('english', value) @@ plainto_tsquery($1)
      ORDER BY score DESC
      LIMIT 20
    `, [q]);

    // Search facts table and merge results
    const factResults = await query<SearchResult>(`
      SELECT m.key, substring(f.fact_text, 1, 300) as value, m.agent_id,
             ts_rank(to_tsvector('english', f.fact_text), plainto_tsquery($1)) as score,
             'fact' as source
      FROM memory.facts f
      JOIN memory.memories m ON m.id = f.memory_id
      WHERE m.is_deleted = FALSE
        AND (m.expires_at IS NULL OR m.expires_at > now())
        AND to_tsvector('english', f.fact_text) @@ plainto_tsquery($1)
      ORDER BY score DESC
      LIMIT 20
    `, [q]);

    // Merge and sort by score descending
    results = [...memoryResults, ...factResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }

  return (
    <div>
      <h1>Search Memories</h1>
      <form method="get" className="search-form">
        <input type="text" name="q" defaultValue={q || ''} placeholder="Search across all agent memories and facts..." />
        <button type="submit">Search</button>
      </form>
      {q && (
        <p className="meta" style={{ marginBottom: 16 }}>
          {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{q}&quot;
        </p>
      )}
      {results.map((r, i) => (
        <div key={i} className="search-result">
          <div className="result-header">
            <strong>{r.key}</strong>
            <span className="meta">agent: {r.agent_id.substring(0, 8)}... · score: {r.score.toFixed(3)}</span>
          </div>
          <pre>{r.value}</pre>
          <div className="result-source">
            source: <span className={`op-badge ${r.source === 'fact' ? 'op-search' : 'op-read'}`}>{r.source}</span>
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
