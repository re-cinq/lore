import type { ZeroResultSearchRow } from "./GapsView";

export interface SearchGroup {
  query: string;
  count: number;
  /** The newest time the query was asked. */
  latest: string;
}

/** The query a search audit row records: `metadata.query`, which is where the search writer puts it, else the memory key older rows carry. */
export function searchQuery(row: ZeroResultSearchRow): string {
  const query = row.metadata?.query;

  if (typeof query === "string" && query.trim() !== "") {
    return query;
  }

  return row.memory_key || "(empty query)";
}

/** The searches folded by query, in the order they were first seen (newest first, as the API returns them). */
export function groupSearches(
  rows: readonly ZeroResultSearchRow[],
): SearchGroup[] {
  const groups = new Map<string, SearchGroup>();

  for (const row of rows) {
    const query = searchQuery(row);
    const seen = groups.get(query);

    if (!seen) {
      groups.set(query, { query, count: 1, latest: row.created_at });
      continue;
    }
    seen.count += 1;
    seen.latest = row.created_at > seen.latest ? row.created_at : seen.latest;
  }

  return [...groups.values()];
}
