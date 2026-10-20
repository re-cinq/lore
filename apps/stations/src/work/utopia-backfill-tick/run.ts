// Binds the weekly Utopia backfill to the ports this process holds (composition root).
import { settings } from "../../outbound/queues.js";
import {
  loreApiTarget,
  postBackfill,
  postOrgMemory,
} from "./lore-api-backfill.js";
import { orgMemoryWalk } from "./org-memory-walk.js";
import { NO_UTOPIA, utopiaBackfillTick } from "./utopia-backfill-tick.js";

export const NO_LORE_API =
  "no LORE_API_URL configured: the Utopia backfill runs in lore-api";

export async function runUtopiaBackfillTick(): Promise<string> {
  const target = loreApiTarget();

  if (!target) {
    return NO_LORE_API;
  }

  const log = (line: string) => console.log(`[utopia-backfill] ${line}`);
  const repos = await utopiaBackfillTick({
    repos: async () =>
      (await settings().onboardedRepos()).map((repo) => repo.full_name).sort(),
    backfill: (repo) => postBackfill(target, repo),
    log,
  });

  if (repos === NO_UTOPIA) {
    return repos;
  }

  return `${repos}; ${await orgMemoryWalk({ walk: () => postOrgMemory(target), log })}`;
}
