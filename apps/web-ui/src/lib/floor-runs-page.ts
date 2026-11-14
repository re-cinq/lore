import { floorRunOf, type AssemblyRun } from "./assembly-run-rows";
import { liveFetch } from "./live-fetch";
import type { components } from "./api/schema";

// The floor's run list as the browser reads it: pages of runs with their stages, asked of lore-api over the tab's live socket (specs/external-floor FR17); types alias the generated schema.
export interface FloorRunsPage {
  runs: AssemblyRun[];
  nextCursor: string | null;
}

export interface FloorRunsQuery {
  repo?: string;
  status?: string;
  cursor?: string;
}

const QUERY_KEYS = ["repo", "status", "cursor"] as const;

export function floorRunsPath(query: FloorRunsQuery): string {
  const params = new URLSearchParams();

  for (const key of QUERY_KEYS) {
    const value = query[key];

    if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params.size > 0 ? `/api/floor-runs?${params}` : "/api/floor-runs";
}

export function floorRunsPageOf(
  page: components["schemas"]["FloorRunPage"],
): FloorRunsPage {
  return { runs: page.runs.map(floorRunOf), nextCursor: page.next_cursor };
}

/** One page of the floor's runs; a refusal answers an empty page rather than taking the list down. */
export async function loadFloorRunsPage(
  query: FloorRunsQuery,
): Promise<FloorRunsPage> {
  const response = await liveFetch(floorRunsPath(query));

  return response.ok
    ? floorRunsPageOf(
        (await response.json()) as components["schemas"]["FloorRunPage"],
      )
    : { runs: [], nextCursor: null };
}
