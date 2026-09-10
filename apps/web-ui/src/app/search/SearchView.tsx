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

/** Cross-source search page: pure render of merged/scored memory/fact/chunk results. */
export default function SearchView(props: SearchViewProps) {
  const { q, repo, repos, results } = props;

  return (
    <div>
      <h1>Search Memories</h1>
      <SearchForm q={q} repo={repo} repos={repos} />
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

/** The query and the repo it is scoped to. A plain GET form, so a search lands in the URL and can be shared or bookmarked. */
function SearchForm({
  q,
  repo,
  repos,
}: Pick<SearchViewProps, "q" | "repo" | "repos">) {
  return (
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
  );
}

interface RepoFilterSelectProps {
  repo?: string;
  repos: SearchRepoOption[];
}

function RepoFilterSelect({ repo, repos }: RepoFilterSelectProps) {
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

interface ResultCountLineProps {
  q?: string;
  repo?: string;
  count: number;
}

function ResultCountLine({ q, repo, count }: ResultCountLineProps) {
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
      <ResultHeader result={r} />
      <pre>{r.value}</pre>
      <ResultSource result={r} />
    </div>
  );
}

function ResultHeader({ result: r }: { result: SearchResult }) {
  return (
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
  );
}

function ResultSource({ result: r }: { result: SearchResult }) {
  return (
    <div className="result-source">
      source:{" "}
      <span className={`op-badge ${sourceBadgeClass(r.source)}`}>
        {formatEnumLabel(r.source)}
      </span>
      {r.repo && <span className={`badge ${styles.repoBadge}`}>{r.repo}</span>}
    </div>
  );
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
