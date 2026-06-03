export interface ZeroResultSearchRow {
  memory_key: string;
  metadata: Record<string, string>;
  created_at: string;
}

export interface GapMemoryRow {
  key: string;
  value: string;
  created_at: string;
}

export interface GapsViewProps {
  gapMemories: GapMemoryRow[];
  zeroResultSearches: ZeroResultSearchRow[];
}

/**
 * Presentational view for the global gap-detection page. Pure render — the
 * container (`page.tsx`) runs the `memory.audit_log` and `memory.memories`
 * queries and passes the resolved rows down. Read-only: no callbacks.
 */
export default function GapsView({ gapMemories, zeroResultSearches }: GapsViewProps) {
  return (
    <div>
      <h1>Gap Detection</h1>
      <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          This is the global view across all repos. For repo-specific gaps, visit{' '}
          <a href="/">Repositories</a> and select a repo.
        </p>
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Context Gap Draft PRs</h2>
        <p className="meta">
          The gap detection agent creates draft PRs when it identifies missing context.
        </p>
        <a
          href="https://github.com/re-cinq/lore/pulls?q=label:context-gap-draft"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: '0.5rem' }}
        >
          View context-gap-draft PRs on GitHub &rarr;
        </a>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Gap Detection Agent Findings</h2>
        {gapMemories.length === 0 ? (
          <p className="meta">No findings from the gap detection agent yet.</p>
        ) : (
          gapMemories.map((mem, i) => (
            <div key={i} className="spec-card">
              <h3>{mem.key}</h3>
              <span className="meta">{new Date(mem.created_at).toLocaleString()}</span>
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{mem.value}</pre>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>Zero-Result Searches</h2>
        <p className="meta">
          Searches that returned no results indicate potential gaps in organizational context.
        </p>
        {zeroResultSearches.length === 0 ? (
          <p className="meta">No zero-result searches recorded.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Query</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Details</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {zeroResultSearches.map((entry, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>{entry.memory_key}</td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                    <code>{JSON.stringify(entry.metadata)}</code>
                  </td>
                  <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }} className="meta">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
