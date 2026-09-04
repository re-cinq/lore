import { displayAgentId } from "@/lib/agent-id";
import { formatEnumLabel } from "@/lib/enum-label";
import styles from "./SearchView.module.css";

export interface SearchResult {
  key: string;
  value: string;
  agent_id: string;
  score: number;
  source: "memory" | "fact" | "chunk" | "episode";
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

function sourceBadgeClass(source: SearchResult["source"]): string {
  if (source === "fact") {
    return "op-search";
  }

  if (source === "chunk") {
    return "op-write";
  }

  return "op-read";
}

function RepoFilterSelect({
  repo,
  repos,
}: {
  repo?: string;
  repos: SearchRepoOption[];
}) {
  return (
    <div className={styles.repoFilter}>
      <select
        name="repo"
        defaultValue={repo || ""}
        className={styles.repoSelect}
      >
        <option value="">All repos</option>
        {repos.map((r) => (
          <option key={r.full_name} value={r.full_name}>
            {r.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ResultCountLine({
  q,
  repo,
  count,
}: {
  q?: string;
  repo?: string;
  count: number;
}) {
  if (!q) {
    return null;
  }

  return (
    <p className={`meta ${styles.resultCount}`}>
      {count} result{count !== 1 ? "s" : ""} for &quot;{q}&quot;
      {repo && (
        <>
          {" "}
          in <strong>{repo}</strong>
        </>
      )}
    </p>
  );
}

function SearchResultCard({ result: r }: { result: SearchResult }) {
  return (
    <div className="search-result">
      <div className="result-header">
        <strong>{r.key}</strong>
        <span className="meta">
          agent: {displayAgentId(r.agent_id)} · score: {r.score.toFixed(3)}
          {r.repo && (
            <>
              {" "}
              · repo: <strong>{r.repo}</strong>
            </>
          )}
        </span>
      </div>
      <pre>{r.value}</pre>
      <div className="result-source">
        source:{" "}
        <span className={`op-badge ${sourceBadgeClass(r.source)}`}>
          {formatEnumLabel(r.source)}
        </span>
        {r.repo && (
          <span className={`badge ${styles.repoBadge}`}>{r.repo}</span>
        )}
      </div>
    </div>
  );
}

/** Cross-source search page: pure render of merged/scored memory/fact/chunk results. */
export default function SearchView({
  q,
  repo,
  repos,
  results,
}: SearchViewProps) {
  return (
    <div>
      <h1>Search Memories</h1>
      <form method="get" className="search-form">
        <RepoFilterSelect repo={repo} repos={repos} />
        <input
          type="text"
          name="q"
          defaultValue={q || ""}
          placeholder="Search memories, facts, and ingested docs..."
        />
        <button type="submit">Search</button>
      </form>
      <ResultCountLine q={q} repo={repo} count={results.length} />
      {results.map((r, i) => (
        <SearchResultCard key={i} result={r} />
      ))}
      {q && results.length === 0 && (
        <div className="empty-state">
          <p>No results found. Try a different search term.</p>
        </div>
      )}
    </div>
  );
}
