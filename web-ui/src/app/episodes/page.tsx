export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

const PAGE_SIZE = 30;

interface Episode {
  id: string;
  agent_id: string;
  source: string;
  ref: string | null;
  content_preview: string;
  fact_count: number;
  created_at: string;
}

interface CountResult { count: number; }

export default async function EpisodesPage({ searchParams }: { searchParams: Promise<{ source?: string; offset?: string }> }) {
  const { source, offset: offsetStr } = await searchParams;
  const offset = Math.max(0, parseInt(offsetStr || '0', 10) || 0);

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (source && source.trim()) {
    conditions.push(`e.source = $${paramIndex}`);
    params.push(source.trim());
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [{ count: totalCount }] = await query<CountResult>(`
    SELECT count(*)::int as count FROM memory.episodes e ${whereClause}
  `, params);

  const episodes = await query<Episode>(`
    SELECT e.id, e.agent_id, e.source, e.ref,
           LEFT(e.content, 300) as content_preview,
           (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count,
           e.created_at
    FROM memory.episodes e
    ${whereClause}
    ORDER BY e.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, params);

  const sources = ['manual', 'session', 'pr-review', 'ci'];

  function buildUrl(newOffset: number): string {
    const p = new URLSearchParams();
    if (source) p.set('source', source);
    if (newOffset > 0) p.set('offset', String(newOffset));
    const qs = p.toString();
    return `/episodes${qs ? `?${qs}` : ''}`;
  }

  return (
    <div>
      <h1>Episodes</h1>
      <p className="meta" style={{ marginBottom: 12 }}>
        Passively ingested text blobs — conversations, reviews, observations. Facts and graph entities are extracted automatically.
      </p>
      <form method="get" className="filter-form">
        <select name="source" defaultValue={source || ''}>
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit">Filter</button>
      </form>
      <p className="meta" style={{ marginBottom: 12 }}>{totalCount} episodes</p>
      <table>
        <thead>
          <tr><th>Time</th><th>Agent</th><th>Source</th><th>Ref</th><th>Facts</th><th>Content</th></tr>
        </thead>
        <tbody>
          {episodes.map(e => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td title={e.agent_id}>{e.agent_id.substring(0, 8)}...</td>
              <td><span className={`op-badge op-${e.source}`}>{e.source}</span></td>
              <td>{e.ref || '\u2014'}</td>
              <td>{e.fact_count}</td>
              <td><pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: '400px' }}>{e.content_preview}{e.content_preview.length >= 300 ? '...' : ''}</pre></td>
            </tr>
          ))}
          {episodes.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 24 }}>
              No episodes yet. Use the <code>write_episode</code> MCP tool to ingest text.
            </td></tr>
          )}
        </tbody>
      </table>
      {totalCount > PAGE_SIZE && (
        <div className="pagination">
          <a href={buildUrl(offset - PAGE_SIZE)} className={offset > 0 ? '' : 'disabled'}>&larr; Previous</a>
          <span className="page-info">{offset + 1}&ndash;{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}</span>
          <a href={buildUrl(offset + PAGE_SIZE)} className={offset + PAGE_SIZE < totalCount ? '' : 'disabled'}>Next &rarr;</a>
        </div>
      )}
    </div>
  );
}
