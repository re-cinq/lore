import "server-only";
import { apiFetch } from "./client";
import type { components } from "./schema";

export type LatestRelease = components["schemas"]["LatestRelease"];

/** Fail-quiet on purpose (a notice in the sidebar of every page): an unreachable lore-api shows the running version with no verdict on updates. lore-api caches GitHub's answer for an hour, so the page revalidates on the same beat. */
export async function getRelease(
  running: string,
): Promise<LatestRelease | null> {
  const result = await apiFetch<LatestRelease>(
    "lore-api",
    `/api/release?running=${encodeURIComponent(running)}`,
    { revalidate: 300 },
  );

  return result.status === "ok" ? result.data : null;
}
