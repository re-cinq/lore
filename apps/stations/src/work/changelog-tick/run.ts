// Binds the changelog tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { changelogTick } from "./changelog-tick.js";

export const NO_FLOOR =
  "no external floor configured: nothing walks the weekly changelog";

export async function runChangelogTick(
  params: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return changelogTick(params, {
    floor: floorClient(),
    repos: async () =>
      (await settings().onboardedRepos()).map((repo) => repo.full_name).sort(),
    weeks: pipeline().changelogWeeks,
    now: () => new Date(),
  });
}
