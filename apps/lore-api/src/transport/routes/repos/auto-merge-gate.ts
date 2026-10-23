// Switching the auto-merge loop off (specs/protected-branch-merge): the auto-merge Lore armed is taken back.
import {
  floorConfigured,
  floorClient,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  parsePullRequestUrl,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { startValue } from "@re-cinq/lore-shared/review/floor-review-runs.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { disarmLorePulls } from "../../../work/repo/auto-merge-approver.js";

/** The floor line the auto-merge loop runs on. */
export const AUTO_MERGE_LINE = "auto-merge";

/** How many of the line's newest runs are read for the pull requests it worked. */
const LOOP_RUNS_READ = 100;

/** Switching auto merge off takes back the auto-merge Lore armed: on the pull requests its App opened and on every pull request the loop worked. A failed disarm never fails the switch: off is the safe state, the setting is already written, and the PR (or the read that failed) is named in the log for a person to disarm by hand. */
export async function disarmAutoMerge(repo: string): Promise<void> {
  const failed = await disarmArmedPulls(repo).catch((err: unknown) => {
    console.error(
      `[auto-merge] could not read ${repo}'s pull requests to disarm them:`,
      err,
    );

    return [];
  });

  if (failed.length > 0) {
    console.error(
      `[auto-merge] could not disarm auto-merge on ${repo} PRs ${failed.join(", ")}`,
    );
  }
}

async function disarmArmedPulls(repo: string): Promise<number[]> {
  const { pulls, audit } = await projectFor(repo);
  const [appLogin, loopPulls] = await Promise.all([
    loreAppLogin(),
    loopPullsOf(repo),
  ]);

  return disarmLorePulls({ pulls, audit, appLogin, loopPulls });
}

/** The pull requests the loop's runs were started for. */
async function loopPullsOf(repo: string): Promise<Set<number>> {
  if (!floorConfigured()) {
    return new Set();
  }
  const { items } = await floorClient().runs.list(
    { repo: floorRepoOf(repo), line: AUTO_MERGE_LINE },
    { limit: LOOP_RUNS_READ },
  );

  return new Set(
    items.flatMap((run) => {
      const url = startValue(run, "pr_url");

      return url ? [parsePullRequestUrl(url).prNumber] : [];
    }),
  );
}
