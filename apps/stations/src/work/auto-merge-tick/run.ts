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
import {
  isOpen,
  startValue,
} from "@re-cinq/lore-shared/review/floor-review-runs.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";
import { autoMergeTick, headKey } from "./auto-merge-tick.js";

export const NO_FLOOR =
  "no external floor configured: the floor walks auto-merge";

const LINE = "auto-merge";

export async function runAutoMergeTick(): Promise<string> {
  if (!floorConfigured()) {
    return NO_FLOOR;
  }

  return autoMergeTick({
    repos: enabledRepos,
    openPulls: async (repo) => (await projectFor(repo)).pulls.list(),
    reviewPassed,
    workedPulls,
    start: startRun,
  });
}

async function enabledRepos(): Promise<string[]> {
  return (await settings().onboardedRepoSettings())
    .filter((row) => autoMergeEnabled(row.settings))
    .map((row) => row.full_name);
}

async function reviewPassed(repo: string, pull: PullRef): Promise<boolean> {
  if (pull.headSha === undefined) {
    return false;
  }
  const checks = await (await projectFor(repo)).pulls.listChecks(pull.headSha);

  return loreReviewVerdict(checks) === "approved";
}

/** How many of the loop's newest runs a tick reads per repository: enough to cover every open pull request's last run. */
const RUNS_READ = 100;

async function workedPulls(repo: string): Promise<Set<string>> {
  const { items: loopRuns } = await floorClient().runs.list(
    { repo: floorRepoOf(repo), line: LINE },
    { limit: RUNS_READ },
  );

  return new Set(loopRuns.flatMap(workKeys));
}

/** An open run holds its pull request; any run holds the head it was started on. */
function workKeys(run: Parameters<typeof startValue>[0]): string[] {
  const url = startValue(run, "pr_url");

  if (!url) {
    return [];
  }
  const head = headKey(url, startValue(run, "head_sha"));

  return isOpen(run) ? [url, head] : [head];
}

async function startRun(repo: string, pull: PullRef): Promise<void> {
  await startLine(floorClient().lines, LINE, {
    repo: floorRepoOf(repo),
    startItems: {
      repo: gitItem(repo, pull.branch),
      pr_url: valueItem(pull.url),
      head_sha: valueItem(pull.headSha ?? ""),
    },
  });
}
