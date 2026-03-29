export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface SearchResult {
  key: string;
  value: string;
  agent_id: string;
  score: number;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  let results: SearchResult[] = [];

  if (q) {
    // Keyword search (vector search requires embedding API call — use keyword for the UI)
    results = await query<SearchResult>(`
      SELECT key, substring(value, 1, 300) as value, agent_id,
             ts_rank(to_tsvector('english', value), plainto_tsquery($1)) as score
      FROM memory.memories
      WHERE is_deleted = FALSE
        AND (expires_at IS NULL OR expires_at > now())
        AND to_tsvector('english', value) @@ plainto_tsquery($1)
      ORDER BY score DESC
      LIMIT 20
    `, [q]);
  }

  return (
    <div>
      <h1>Search Memories</h1>
      <form method="get" className="search-form">
        <input type="text" name="q" defaultValue={q || ''} placeholder="Search across all agent memories..." />
        <button type="submit">Search</button>
      </form>
      {q && (
        <p className="meta">{results.length} results for &quot;{q}&quot;</p>
      )}
      {results.map((r, i) => (
        <div key={i} className="search-result">
          <div className="result-header">
            <strong>{r.key}</strong>
            <span className="meta">agent: {r.agent_id.substring(0, 8)}... · score: {r.score.toFixed(3)}</span>
          </div>
          <pre>{r.value}</pre>
        </div>
      ))}
    </div>
  );
}
