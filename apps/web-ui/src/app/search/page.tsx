export const dynamic = "force-dynamic";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import { searchMemory } from "@/lib/api/memory";
import { getChunks } from "@/lib/api/chunks";
import SearchView, {
  type SearchResult,
  type SearchRepoOption,
} from "./SearchView";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; repo?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, repo } = await searchParams;
  const repos = await repoFilterOptions();
  const results = q ? await runSearch(q, repo) : [];

  return <SearchView q={q} repo={repo} repos={repos} results={results} />;
}

/** The options behind the repo filter dropdown, in name order. */
async function repoFilterOptions(): Promise<SearchRepoOption[]> {
  const { repos: onboarded } = reposOrThrow(await listAllRepos());

  return onboarded
    .map((repo) => ({ full_name: repo.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/** One memory call covers memories and facts alike — lore-api runs both ranked searches and returns them as one list — and the chunk hits come from lore-api too, which owns the schema union. */
async function runSearch(q: string, repo?: string): Promise<SearchResult[]> {
  const memoryHits = await searchMemory(q);
  const memoryResults = (memoryHits.status === "ok"
    ? memoryHits.data.results
    : []) as unknown as SearchResult[];
  const chunkHits = await getChunks({ repo, q, limit: 20 });
  const chunkResults = (chunkHits.status === "ok"
    ? chunkHits.data.chunks
    : []) as unknown as SearchResult[];
  const allResults = [...memoryResults, ...chunkResults];

  return allResults.sort((a, b) => b.score - a.score).slice(0, 30);
}
