// Binds the weekly Utopia backfill to the ports this process holds (composition root).
import { settings } from "../../outbound/queues.js";
import { loreApiTarget, postBackfill } from "./lore-api-backfill.js";
import { utopiaBackfillTick } from "./utopia-backfill-tick.js";

export const NO_LORE_API =
  "no LORE_API_URL configured: the Utopia backfill runs in lore-api";

export async function runUtopiaBackfillTick(): Promise<string> {
  const target = loreApiTarget();

  if (!target) {
    return NO_LORE_API;
  }

  return utopiaBackfillTick({
    repos: async () =>
      (await settings().onboardedRepos()).map((repo) => repo.full_name).sort(),
    backfill: (repo) => postBackfill(target, repo),
    log: (line) => console.log(`[utopia-backfill] ${line}`),
  });
}
