export const dynamic = "force-dynamic";
import { listRepos } from "@/lib/api/repos";
import { searchMemory } from "@/lib/api/memory";
import { queryAllChunks } from "@/lib/db";
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
  const repoList = await listRepos();
  const repos: SearchRepoOption[] =
    repoList.status === "ok"
      ? repoList.data.repos
          .map((repo) => ({ full_name: repo.full_name }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
      : [];

  if (q) {
    // One call for both the memory and the fact hits: lore-api runs the same
    // two ranked searches and returns them as one list.
    const memoryHits = await searchMemory(q);
    const memoryResults = (memoryHits.status === "ok"
      ? memoryHits.data.results
      : []) as unknown as SearchResult[];

    // Search repo chunks across all schemas (scoped by repo if filtered)
    const chunkResults = await queryAllChunks<SearchResult>(
      (schema, offset) => {
        const repoFilter = repo ? `AND c.repo = $${offset + 1}` : "";

        return {
          sql: `SELECT c.file_path as key, substring(c.content, 1, 300) as value,
                       'ingestion' as agent_id,
                       ts_rank(c.search_tsv, websearch_to_tsquery('english', $${offset})) as score,
                       'chunk' as source,
                       c.repo as repo
                FROM ${schema}.chunks c
                WHERE c.search_tsv @@ websearch_to_tsquery('english', $${offset})
                  ${repoFilter}`,
          params: repo ? [q, repo] : [q],
        };
      },
      [],
      { orderBy: "score DESC", limit: 20 },
    );

    // Merge and sort by score descending, capped at 30
    const allResults = [...memoryResults, ...chunkResults];

    results = allResults.sort((a, b) => b.score - a.score).slice(0, 30);
  }

  return <SearchView q={q} repo={repo} repos={repos} results={results} />;
}
