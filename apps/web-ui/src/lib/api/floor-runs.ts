import "server-only";
import {
  floorRunsPageOf,
  floorRunsPath,
  type FloorRunsPage,
  type FloorRunsQuery,
} from "../floor-runs-page";
import { apiFetch } from "./client";
import type { components } from "./schema";

/** One page of the floor's runs as the list draws them, a repository's when one is named; an unreachable lore-api answers an empty page rather than taking the list down. */
export async function getFloorRuns(
  query: FloorRunsQuery,
): Promise<FloorRunsPage> {
  const result = await apiFetch<components["schemas"]["FloorRunPage"]>(
    "lore-api",
    floorRunsPath(query),
  );

  if (result.status !== "ok") {
    return { runs: [], nextCursor: null };
  }

  return floorRunsPageOf(result.data);
}
