// Presentational (data-down) list of a repo's spec documents, sourced from the
// spec-traceability graph via the /trace API. Each path links to the structured
// detail view. No Postgres chunk reads — the graph is the source of truth.
import Link from 'next/link';

export default function SpecListView({ owner, repo, specs }: { owner: string; repo: string; specs: string[] }) {
  if (specs.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)' }}>
        No specs in the graph yet. Build the graph from the <strong>Graph</strong> tab and run the <code>ingest-specs</code>{' '}
        task, then refresh.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {specs.map((path) => (
        <li key={path} style={{ marginBottom: 6 }}>
          <Link href={`/repos/${owner}/${repo}/specs/${encodeURIComponent(path)}`}>{path}</Link>
        </li>
      ))}
    </ul>
  );
}
