// Binds the auto-merge tick to the ports this process holds (composition root).
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  gitItem,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { autoMergeEnabled } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreReviewVerdict } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import { startValue } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";
import { autoMergeTick } from "./auto-merge-tick.js";

export const NO_FLOOR =
  "no external floor configured: the floor walks auto-merge";

const LINE = "auto-merge";

export async function runAutoMergeTick(): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return autoMergeTick({
    repos: async () =>
      (await settings().onboardedRepoSettings())
        .filter((row) => autoMergeEnabled(row.settings))
        .map((row) => row.full_name),
    openPulls: async (repo) => (await projectFor(repo)).pulls.list(),
    reviewPassed: async (repo, pull) =>
      pull.headSha !== undefined &&
      loreReviewVerdict(
        await (await projectFor(repo)).pulls.listChecks(pull.headSha),
      ) === "approved",
    workedPulls: async (repo) => {
      const { items } = await floorClient().runs.list({
        repo: floorRepoOf(repo),
        line: LINE,
        open: true,
      });

      return new Set(items.flatMap((run) => startValue(run, "pr_url") ?? []));
    },
    start: async (repo, pull) => {
      await startLine(floorClient().lines, LINE, {
        repo: floorRepoOf(repo),
        startItems: {
          repo: gitItem(repo, pull.branch),
          pr_url: valueItem(pull.url),
        },
      });
    },
  });
}
