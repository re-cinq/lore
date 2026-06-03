export const dynamic = "force-dynamic";
import Link from 'next/link';
import { queryAllChunks } from '@/lib/db';

interface Spec {
  file_path: string;
  repo: string | null;
  ingested_at: string;
  excerpt: string;
}

interface RepoCount {
  repo: string;
  count: number;
}

export default async function SpecsPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;

  // Get available repos for filter buttons (only repos that have spec-type content)
  const allRepoCounts = await queryAllChunks<RepoCount>(
    (schema) => ({
      sql: `SELECT repo, count(*)::int as count
            FROM ${schema}.chunks
            WHERE content_type = 'spec' AND repo IS NOT NULL
                  AND file_path LIKE '%.md'
            GROUP BY repo`,
      params: [],
    }),
  );
  // Merge counts across schemas
  const repoMap = new Map<string, number>();
  for (const row of allRepoCounts) {
    if (row.repo) {
      repoMap.set(row.repo, (repoMap.get(row.repo) || 0) + row.count);
    }
  }
  const repos = [...repoMap.entries()]
    .map(([r, count]) => ({ repo: r, count }))
    .sort((a, b) => b.count - a.count);

  // Fetch specs across all schemas, always filtered to content_type = 'spec'
  const allSpecs = await queryAllChunks<Spec>(
    (schema, offset) => {
      if (repo && repo.trim()) {
        return {
          sql: `SELECT file_path, repo, ingested_at,
                       substring(content, 1, 200) as excerpt
                FROM ${schema}.chunks
                WHERE content_type = 'spec' AND repo = $${offset}
                      AND file_path LIKE '%.md'`,
          params: [repo.trim()],
        };
      }
      return {
        sql: `SELECT file_path, repo, ingested_at,
                     substring(content, 1, 200) as excerpt
              FROM ${schema}.chunks
              WHERE content_type = 'spec' AND file_path LIKE '%.md'`,
        params: [],
      };
    },
  );
  const specs = allSpecs
    .sort((a, b) => new Date(b.ingested_at).getTime() - new Date(a.ingested_at).getTime())
    .slice(0, 50);

  return (
    <div>
      <h1>Specifications</h1>
      <div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          This is the global view across all repos. For repo-specific specs, visit{' '}
          <Link href="/">Repositories</Link> and select a repo.
        </p>
      </div>
      <p className="meta" style={{ marginBottom: 16 }}>
        Browse ingested spec files from across all repos.
      </p>

      <div className="filter-buttons">
        <Link href="/specs" className={!repo ? 'active' : ''}>
          All repos
        </Link>
        {repos.map(r => (
          <Link
            key={r.repo}
            href={`/specs?repo=${encodeURIComponent(r.repo)}`}
            className={repo === r.repo ? 'active' : ''}
          >
            {r.repo} ({r.count})
          </Link>
        ))}
      </div>

      <p className="meta" style={{ marginBottom: 16 }}>
        {specs.length} spec{specs.length !== 1 ? 's' : ''}{repo ? ` in "${repo}"` : ''}
      </p>

      {specs.map((s, i) => (
        <div key={i} className="spec-card">
          <h3>
            <Link href={`/specs/${encodeURIComponent(s.file_path)}`}>
              {s.file_path}
            </Link>
          </h3>
          <span className="badge badge-blue">spec</span>
          {s.repo && (
            <span className="meta" style={{ marginLeft: 8 }}>
              <Link href={`/repos/${s.repo}`}>{s.repo}</Link>
            </span>
          )}
          <span className="meta" style={{ marginLeft: 8 }}>
            {new Date(s.ingested_at).toLocaleString()}
          </span>
          <pre>{s.excerpt}...</pre>
        </div>
      ))}
      {specs.length === 0 && (
        <div className="empty-state">
          <p>No specs ingested yet{repo ? ` for repo "${repo}"` : ''}.</p>
        </div>
      )}
    </div>
  );
}
