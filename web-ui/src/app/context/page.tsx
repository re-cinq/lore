export const dynamic = "force-dynamic";

import { query } from '@/lib/db';

interface Chunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
}

export default async function ContextPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;

  const chunks = await query<Chunk>(`
    SELECT id, file_path, content_type, substring(content, 1, 300) as content, ingested_at
    FROM org_shared.chunks
    WHERE ($1::text IS NULL OR content_type = $1)
    ORDER BY ingested_at DESC
    LIMIT 50
  `, [type || null]);

  const types = ['doc', 'adr', 'spec', 'code', 'runbook'];

  return (
    <div>
      <h1>Organization Context</h1>
      <div className="filter-form">
        <a href="/context" className={!type ? 'active' : ''}>All</a>
        {types.map(t => (
          <a key={t} href={`/context?type=${t}`} className={type === t ? 'active' : ''}>{t}</a>
        ))}
      </div>
      {chunks.length === 0 ? (
        <p className="meta">No context chunks found{type ? ` for type "${type}"` : ''}.</p>
      ) : (
        chunks.map(c => (
          <div key={c.id} className="spec-card">
            <h3>{c.file_path}</h3>
            <span className="badge">{c.content_type}</span>
            <span className="meta">{new Date(c.ingested_at).toLocaleString()}</span>
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{c.content}...</pre>
          </div>
        ))
      )}
    </div>
  );
}
