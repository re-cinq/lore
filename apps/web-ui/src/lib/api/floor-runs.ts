import "server-only";
import { floorRunOf } from "../assembly-run-rows";
import type { AssemblyRun } from "../assembly-run-rows";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// The floor's run list (specs/external-floor): pages of runs with their stages, and the token that opens the live `runs` channel; types alias the generated schema.
export interface FloorRunsPage {
  runs: AssemblyRun[];
  nextCursor: string | null;
}

export type FloorRunsStreamToken =
  components["schemas"]["FloorRunsStreamToken"];

/** One page of the floor's runs as the list draws them; an unreachable lore-api answers an empty page rather than taking the list down. */
export async function getFloorRuns(query: {
  status?: string;
  cursor?: string;
}): Promise<FloorRunsPage> {
  const result = await apiFetch<components["schemas"]["FloorRunPage"]>(
    "lore-api",
    floorRunsPath(query),
  );

  if (result.status !== "ok") {
    return { runs: [], nextCursor: null };
  }

  const { runs, next_cursor: nextCursor } = result.data;

  return { runs: runs.map(floorRunOf), nextCursor };
}

const QUERY_KEYS = ["status", "cursor"] as const;

function floorRunsPath(query: { status?: string; cursor?: string }): string {
  const params = new URLSearchParams();

  for (const key of QUERY_KEYS) {
    const value = query[key];

    if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params.size > 0 ? `/api/floor-runs?${params}` : "/api/floor-runs";
}

/** A short-lived token that opens the `runs` channel of the live socket as this person. */
export function mintRunsStreamToken(user: {
  id: string;
  name: string;
}): Promise<ApiResult<FloorRunsStreamToken>> {
  return apiFetch("lore-api", "/api/floor-runs/stream-token", {
    method: "POST",
    body: { user },
  });
}
