import Link from "next/link";
import Icon from "@/components/Icon";
import ScreenHeader from "@/components/ScreenHeader";
import { formatEnumLabel } from "@/lib/enum-label";
import SearchResultCard from "./SearchResultCard";
import styles from "./SearchView.module.css";

export type SearchSource = "memory" | "fact" | "chunk" | "episode";

export interface SearchResult {
  key: string;
  value: string;
  agent_id: string;
  score: number;
  source: SearchSource;
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
  /** The source chip the results are narrowed to, or undefined for all. */
  source?: string;
  /** Options for the repo filter dropdown. */
  repos: SearchRepoOption[];
  /** Merged, scored, sorted result rows for the current query. */
  results: SearchResult[];
}

const SOURCES: SearchSource[] = ["memory", "fact", "chunk", "episode"];

const LEDE =
  "Memories, facts, ingested docs and episodes, ranked by hybrid vector and keyword search.";

/** Cross-source search page: pure render of merged/scored memory/fact/chunk results. */
export default function SearchView(props: SearchViewProps) {
  const { q, repo, repos, results } = props;
  const source = SOURCES.find((s) => s === props.source);
  const shown = source ? results.filter((r) => r.source === source) : results;

  return (
    <div className={styles.page}>
      <ScreenHeader group="knowledge" title="Search" lede={LEDE} />
      <SearchForm q={q} repo={repo} repos={repos} />
      {q && <SourceBar q={q} repo={repo} source={source} results={results} />}
      <ResultCards results={shown} />
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
    <form method="get" role="search" className={styles.field}>
      <Icon name="search" size={18} className={styles.fieldIcon} />
      <QueryInput q={q} />
      <RepoFilterSelect repo={repo} repos={repos} />
      {/* eslint-disable-next-line no-restricted-syntax, re-lint/no-unguarded-async-button -- native GET search form, no mutation, no client JS state to show */}
      <button type="submit" className={styles.submit}>
        Search
      </button>
    </form>
  );
}

function QueryInput({ q }: { q?: string }) {
  return (
    <input
      type="text"
      name="q"
      aria-label="Search query"
      defaultValue={q || ""}
      placeholder="Search memories, facts, and ingested docs..."
      className={styles.query}
    />
  );
}

interface RepoFilterSelectProps {
  repo?: string;
  repos: SearchRepoOption[];
}

function RepoFilterSelect({ repo, repos }: RepoFilterSelectProps) {
  return (
    <select
      name="repo"
      aria-label="Repository"
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
  );
}

interface SourceBarProps {
  q: string;
  repo?: string;
  source?: SearchSource;
  results: SearchResult[];
}

/** The source chips and the result count, on one line under the field. */
function SourceBar({ q, repo, source, results }: SourceBarProps) {
  return (
    <div className={styles.sourceBar}>
      <SourceChips q={q} repo={repo} source={source} results={results} />
      <ResultCountLine q={q} repo={repo} count={results.length} />
    </div>
  );
}

/** One chip per source that has hits, plus All. Links, not buttons: a narrowed search is a URL like any other. Counts come from the full set so a narrowed view still says what the others hold. */
function SourceChips({ q, repo, source, results }: SourceBarProps) {
  return (
    <nav aria-label="Result sources" className={styles.chips}>
      {sourceChips(results).map((chip) => (
        <Link
          key={chip.label}
          href={sourceHref({ q, repo, source: chip.source })}
          className={styles.chip}
          aria-current={chip.source === source ? "true" : undefined}
        >
          {chip.label}
          <span className={styles.chipCount}>{chip.count}</span>
        </Link>
      ))}
    </nav>
  );
}

/** All, then each source that has a hit, with its count. */
function sourceChips(results: SearchResult[]) {
  const present = SOURCES.filter((s) => results.some((r) => r.source === s));

  return [undefined, ...present].map((s) => ({
    source: s,
    label: s ? formatEnumLabel(s) : "All",
    count: s ? results.filter((r) => r.source === s).length : results.length,
  }));
}

function sourceHref(params: Pick<SourceBarProps, "q" | "repo" | "source">) {
  const query = new URLSearchParams({ q: params.q });

  if (params.repo) {
    query.set("repo", params.repo);
  }

  if (params.source) {
    query.set("source", params.source);
  }

  return `/search?${query.toString()}`;
}

interface ResultCountLineProps {
  q?: string;
  repo?: string;
  count: number;
}

function ResultCountLine({ q, repo, count }: ResultCountLineProps) {
  return (
    <p className={styles.resultCount}>
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

/** The cards, each score drawn against the best one on the page. */
function ResultCards({ results }: { results: SearchResult[] }) {
  const best = Math.max(0, ...results.map((r) => r.score));

  return (
    <div className={styles.results}>
      {results.map((r, i) => (
        <SearchResultCard key={i} result={r} best={best} />
      ))}
    </div>
  );
}
