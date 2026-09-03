export const dynamic = "force-dynamic";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import { searchMemory } from "@/lib/api/memory";
import { getChunks } from "@/lib/api/chunks";
import SearchView, {
  type SearchResult,
  type SearchRepoOption,
} from "./SearchView";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; repo?: string }>;
}) {
  const { q, repo } = await searchParams;
  let results: SearchResult[] = [];

  // Populate repo filter dropdown
  const repoList = reposOrThrow(await listAllRepos());
  const repos: SearchRepoOption[] = repoList.repos
    .map((repo) => ({ full_name: repo.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  if (q) {
    // One call for both memory and facts: lore-api runs both ranked searches and returns them as one list
    const memoryHits = await searchMemory(q);
    const memoryResults = (memoryHits.status === "ok"
      ? memoryHits.data.results
      : []) as unknown as SearchResult[];

    // Chunk hits come from lore-api, which owns the schema union.
    const chunkHits = await getChunks({ repo, q, limit: 20 });
    const chunkResults = (chunkHits.status === "ok"
      ? chunkHits.data.chunks
      : []) as unknown as SearchResult[];

    const allResults = [...memoryResults, ...chunkResults];

    results = allResults.sort((a, b) => b.score - a.score).slice(0, 30);
  }

  return <SearchView q={q} repo={repo} repos={repos} results={results} />;
}
