export interface ContextChunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
}

export interface ContextViewProps {
  /** The active content_type filter, or undefined for "All". */
  type?: string;
  chunks: ContextChunk[];
}

const TYPES = ['doc', 'adr', 'spec', 'code', 'runbook'];

/**
 * Presentational view for the global cross-repo context list. Pure render —
 * the container (`page.tsx`) runs the cross-schema query, sorts by
 * ingested_at, slices to the 50 most recent, and passes the resolved
 * view-model down.
 */
export default function ContextView({ type, chunks }: ContextViewProps) {
  return (
    <div>
      <h1>Organization Context</h1>
      <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          This is the global view across all repos. For repo-specific context, visit{' '}
          <a href="/">Repositories</a> and select a repo.
        </p>
      </div>
      <div className="filter-form">
        <a href="/context" className={!type ? 'active' : ''}>All</a>
        {TYPES.map(t => (
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
