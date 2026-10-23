// Binds the spec upkeep tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  enabledUpkeepRepos,
  specUpkeepTick,
} from "@re-cinq/lore-shared/spec-upkeep/floor-spec-upkeep.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";

export const NO_FLOOR =
  "no external floor configured: the Floor walks spec-drift and spec-coverage-backfill";

export async function runSpecUpkeepTick(
  params: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return specUpkeepTick(params, {
    floor: floorClient(),
    repos: async () =>
      enabledUpkeepRepos(await settings().onboardedRepoSettings()),
    openPrBranches: async (repo) =>
      (await (await projectFor(repo)).pulls.list()).map((pr) => pr.branch),
    now: () => new Date(),
  });
}
