import "server-only";
import { apiFetch } from "./client";
import type { components } from "./schema";

export type PrStatus = components["schemas"]["PrStatus"];

/** A pull request's title as GitHub reports it through lore-api, or null when the read fails: a page names the PR by its number rather than not at all. */
export async function fetchPrTitle(
  repo: string,
  prNumber: number,
): Promise<string | null> {
  const query = new URLSearchParams({ repo, pr_number: String(prNumber) });
  const result = await apiFetch<PrStatus>(
    "lore-api",
    `/api/pr-status?${query.toString()}`,
  );

  return result.status === "ok" ? result.data.title : null;
}
