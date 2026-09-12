import {
  ciFailureReport,
  ciJudgedSha,
  explainFailedChecks,
  type CiFailureReport,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";

/** The reads a CI report needs, bound to one repo — the facade already has them all. */
export type CiPulls = Pick<
  PullRequests,
  "get" | "listBranchCommits" | "listChecks" | "failedJob"
>;

/** What the caller knows: its branch (a pod always does) or a pull request number (a person sometimes does). */
export type CiTarget = { branch: string } | { prNumber: number };

/** How far back a judgeable commit is looked for. A branch whose last thirty commits all skipped CI has no build to report on. */
const JUDGED_WINDOW = 30;

/** What CI says about a branch, explained per failed job — the same judgement the CI wait makes, offered as a read. Null when the pull request named does not exist. */
export async function readCiFailures(
  pulls: CiPulls,
  target: CiTarget,
): Promise<CiFailureReport | null> {
  const branch = await branchOf(pulls, target);

  if (branch === null) {
    return null;
  }
  const judged = ciJudgedSha(
    await pulls.listBranchCommits(branch, JUDGED_WINDOW),
  );

  if (judged === null) {
    return ciFailureReport(branch, null, []);
  }
  const checks = await explainFailedChecks(
    await pulls.listChecks(judged),
    (jobId) => pulls.failedJob(jobId),
  );

  return ciFailureReport(branch, judged, checks);
}

/** The branch a target names, read off the pull request when that is what the caller holds. */
async function branchOf(
  pulls: CiPulls,
  target: CiTarget,
): Promise<string | null> {
  return "branch" in target
    ? target.branch
    : ((await pulls.get(target.prNumber))?.branch ?? null);
}
