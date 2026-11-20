// Binds the release tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { releaseTick } from "./release-tick.js";

export const NO_FLOOR =
  "no external floor configured: nothing walks the scheduled releases";

export async function runReleaseTick(): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }
  const github = new PlatformGitHub(process.env);

  return releaseTick({
    floor: floorClient(),
    repoSettings: () => settings().onboardedRepoSettings(),
    releases: pipeline().changelogReleases,
    headSha: async (repo) =>
      github.branchHeadSha(repo, await github.getDefaultBranch(repo)),
    now: () => new Date(),
  });
}
