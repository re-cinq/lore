import { type SearchResult } from "./SearchView";

export function filterCrossRepoMemories(
  results: SearchResult[],
  selectedRepo?: string,
): SearchResult[] {
  if (!selectedRepo) {
    return results;
  }

  return results.filter((r) => r.repo === null || r.repo === selectedRepo);
}
