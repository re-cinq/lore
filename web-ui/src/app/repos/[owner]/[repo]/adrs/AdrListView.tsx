// Presentational ADR list, sourced from the spec-traceability graph via the
// /trace API. Each path links to the byte-exact ADR detail (reassembled from
// the graph's Block layer). No Postgres reads — the graph is the source of truth.
import Link from 'next/link';

export default function AdrListView({ owner, repo, adrs }: { owner: string; repo: string; adrs: string[] }) {
  if (adrs.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)' }}>
        No ADRs in the graph yet. Build the graph from the <strong>Graph</strong> tab and run the <code>ingest-adrs</code>{' '}
        task, then refresh.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {adrs.map((path) => (
        <li key={path} style={{ marginBottom: 6 }}>
          <Link href={`/repos/${owner}/${repo}/adrs/${encodeURIComponent(path)}`}>{path}</Link>
        </li>
      ))}
    </ul>
  );
}
