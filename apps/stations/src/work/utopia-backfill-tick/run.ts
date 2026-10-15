// Binds the weekly Utopia backfill to the ports this process holds (composition root).
import { settings } from "../../outbound/queues.js";
import { postBackfill } from "./lore-api-backfill.js";
import { utopiaBackfillTick } from "./utopia-backfill-tick.js";

const HALF_AN_HOUR_MS = 30 * 60_000;

export const NO_LORE_API =
  "no LORE_API_URL configured: the Utopia backfill runs in lore-api";

export async function runUtopiaBackfillTick(): Promise<string> {
  const baseUrl = process.env.LORE_API_URL;

  if (!baseUrl) {
    return NO_LORE_API;
  }
  const target = {
    baseUrl,
    token: process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN,
    timeoutMs: HALF_AN_HOUR_MS,
  };

  return utopiaBackfillTick({
    repos: async () =>
      (await settings().onboardedRepos()).map((repo) => repo.full_name).sort(),
    backfill: (repo) => postBackfill(target, repo),
    log: (line) => console.log(`[utopia-backfill] ${line}`),
  });
}
