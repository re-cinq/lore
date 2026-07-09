import { humanizeEnum } from '@/lib/humanize';
import styles from './SearchView.module.css';

export interface SearchResult {
  key: string;
  value: string;
  agent_id: string;
  score: number;
  source: 'memory' | 'fact' | 'chunk' | 'episode';
  repo: string | null;
}

export interface SearchRepoOption {
  full_name: string;
}

export interface SearchViewProps {
  /** The active query string, or undefined when no search has run. */
  q?: string;
  /** The active repo filter, or undefined for "All repos". */
  repo?: string;
  /** Options for the repo filter dropdown. */
  repos: SearchRepoOption[];
  /** Merged, scored, sorted result rows for the current query. */
  results: SearchResult[];
}

function sourceBadgeClass(source: SearchResult['source']): string {
  return source === 'fact' ? 'op-search' : source === 'chunk' ? 'op-write' : 'op-read';
}

/**
 * Presentational view for the cross-source search page. Pure render — the
 * container (`page.tsx`) runs the memory/fact/chunk queries, merges and scores
 * them, and passes the resolved view-model down.
 */
export default function SearchView({ q, repo, repos, results }: SearchViewProps) {
  return (
    <div>
      <h1>Search Memories</h1>
      <form method="get" className="search-form">
        <div className={styles.repoFilter}>
          <select name="repo" defaultValue={repo || ''} className={styles.repoSelect}>
            <option value="">All repos</option>
            {repos.map(r => (
              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        </div>
        <input type="text" name="q" defaultValue={q || ''} placeholder="Search memories, facts, and ingested docs..." />
        <button type="submit">Search</button>
      </form>
      {q && (
        <p className={`meta ${styles.resultCount}`}>
          {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{q}&quot;
          {repo && <> in <strong>{repo}</strong></>}
        </p>
      )}
      {results.map((r, i) => (
        <div key={i} className="search-result">
          <div className="result-header">
            <strong>{r.key}</strong>
            <span className="meta">
              agent: {r.agent_id.substring(0, 8)}... · score: {r.score.toFixed(3)}
              {r.repo && <> · repo: <strong>{r.repo}</strong></>}
            </span>
          </div>
          <pre>{r.value}</pre>
          <div className="result-source">
            source: <span className={`op-badge ${sourceBadgeClass(r.source)}`}>{humanizeEnum(r.source)}</span>
            {r.repo && <span className={`badge ${styles.repoBadge}`}>{r.repo}</span>}
          </div>
        </div>
      ))}
      {q && results.length === 0 && (
        <div className="empty-state">
          <p>No results found. Try a different search term.</p>
        </div>
      )}
    </div>
  );
}
