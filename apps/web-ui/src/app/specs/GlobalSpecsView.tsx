// Presentational cross-repo spec list, sourced from the spec-traceability graph
// (/api/trace/specs). Groups by repo; each path links to that repo's structured
// graph detail. No Postgres chunk reads — the graph is the source of truth.
import Link from 'next/link';

export default function GlobalSpecsView({ specs }: { specs: Array<{ repo: string; filePath: string }> }) {
  if (specs.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>No specs in the graph yet. Specs are projected automatically by CI on push to <code>main</code>.</p>;
  }

  const byRepo = new Map<string, string[]>();
  for (const { repo, filePath } of specs) {
    const bucket = byRepo.get(repo) ?? [];
    if (!byRepo.has(repo)) byRepo.set(repo, bucket);
    bucket.push(filePath);
  }

  return (
    <div>
      {[...byRepo.entries()].map(([repo, paths]) => (
        <section key={repo} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16 }}>{repo}</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {paths.map((filePath) => (
              <li key={filePath} style={{ marginBottom: 4 }}>
                <Link href={`/repos/${repo}/specs/${encodeURIComponent(filePath)}`}>{filePath}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
