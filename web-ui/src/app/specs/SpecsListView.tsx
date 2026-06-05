import Link from 'next/link';
import styles from './SpecsListView.module.css';

export interface SpecListItem {
  file_path: string;
  repo: string | null;
  ingested_at: string;
  excerpt: string;
}

export interface RepoCount {
  repo: string;
  count: number;
}

export interface SpecsListViewProps {
  /** The active repo filter, or undefined for "All repos". */
  activeRepo?: string;
  repos: RepoCount[];
  specs: SpecListItem[];
}

/**
 * Presentational view for the global cross-repo specs list. Pure render —
 * the container (`page.tsx`) runs the cross-schema queries, dedups by
 * file_path, and passes the resolved view-model down.
 */
export default function SpecsListView({ activeRepo, repos, specs }: SpecsListViewProps) {
  return (
    <div>
      <h1>Specifications</h1>
      <div className={styles.notice}>
        <p className={`meta ${styles.noticeText}`}>
          This is the global view across all repos. For repo-specific specs, visit{' '}
          <Link href="/">Repositories</Link> and select a repo.
        </p>
      </div>
      <p className={`meta ${styles.intro}`}>
        Browse ingested spec files from across all repos.
      </p>

      <div className="filter-buttons">
        <Link href="/specs" className={!activeRepo ? 'active' : ''}>
          All repos
        </Link>
        {repos.map(r => (
          <Link
            key={r.repo}
            href={`/specs?repo=${encodeURIComponent(r.repo)}`}
            className={activeRepo === r.repo ? 'active' : ''}
          >
            {r.repo} ({r.count})
          </Link>
        ))}
      </div>

      <p className={`meta ${styles.count}`}>
        {specs.length} spec{specs.length !== 1 ? 's' : ''}{activeRepo ? ` in "${activeRepo}"` : ''}
      </p>

      {specs.map((s) => (
        <div key={`${s.repo ?? ''}-${s.file_path}`} className="spec-card">
          <h3>
            <Link href={`/specs/${encodeURIComponent(s.file_path)}`}>
              {s.file_path}
            </Link>
          </h3>
          <span className="badge badge-blue">spec</span>
          {s.repo && (
            <span className={`meta ${styles.repoMeta}`}>
              <Link href={`/repos/${s.repo}`}>{s.repo}</Link>
            </span>
          )}
          <span className={`meta ${styles.repoMeta}`}>
            {new Date(s.ingested_at).toLocaleString()}
          </span>
          <pre>{s.excerpt}...</pre>
        </div>
      ))}
      {specs.length === 0 && (
        <div className="empty-state">
          <p>No specs ingested yet{activeRepo ? ` for repo "${activeRepo}"` : ''}.</p>
        </div>
      )}
    </div>
  );
}
