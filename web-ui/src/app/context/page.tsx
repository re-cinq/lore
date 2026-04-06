export const dynamic = "force-dynamic";

import { query, queryAllChunks } from '@/lib/db';

interface Chunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
}

export default async function ContextPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;

  const allChunks = await queryAllChunks<Chunk>(
    (schema, offset) => ({
      sql: `SELECT id, file_path, content_type, substring(content, 1, 300) as content, ingested_at
            FROM ${schema}.chunks
            WHERE ($${offset}::text IS NULL OR content_type = $${offset})`,
      params: [type || null],
    }),
  );
  const chunks = allChunks.sort((a, b) => new Date(b.ingested_at).getTime() - new Date(a.ingested_at).getTime()).slice(0, 50);

  const types = ['doc', 'adr', 'spec', 'code', 'runbook'];

  return (
    <div>
      <h1>Organization Context</h1>
      <div style={{ background: 'var(--bg-muted, #1a1a2e)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          This is the global view across all repos. For repo-specific context, visit{' '}
          <a href="/">Repositories</a> and select a repo.
        </p>
      </div>
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
