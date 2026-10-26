// Whether a push earns a re-check now (#3601): the commit range since the last verdict, a sha judged already, and CI. A re-check judges a head once its CI is green, never while CI runs or is red, since a red build brings another push and a verdict on it would be judged again; a check suite that completes green starts it.
import type { RunView } from "@re-cinq/floor-client";
import type {
  CheckRun,
  PullCommit,
  PullRef,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
  loreReviewVerdict,
} from "../../outbound/project/pulls/check-runs.js";
import { decideRecheck } from "./code-review-decisions.js";
import {
  headShaOf,
  isOpen,
  judgedShas,
  lastJudgedSha,
  rangeSince,
} from "./floor-review-runs.js";

export interface RecheckReads {
  listCommits(number: number): Promise<PullCommit[]>;
  listChecks(ref: string): Promise<CheckRun[]>;
}

export interface RecheckPlan {
  start: boolean;
  reason: string;
  sinceSha?: string;
  judged?: string;
  /** The commit CI judges at the head, and the one it judged at the last verdict. */
  ciShas?: { head?: string; judged?: string };
}

/** Whether a push earns a re-check at all: a range to judge, no run on the head already, and no verdict of Lore's standing on it (a carried approval among them). CI is waited for after an approval had its chance to carry. */
export async function planRecheck(
  pulls: RecheckReads,
  pr: Pick<PullRef, "number" | "headSha">,
  runs: RunView[],
): Promise<RecheckPlan> {
  const [commits, headChecks] = await Promise.all([
    pulls.listCommits(pr.number),
    pr.headSha ? pulls.listChecks(pr.headSha) : [],
  ]);
  const judged = lastJudgedSha(runs);
  const range = rangeSince(commits, judged);
  const decision = pushDecision(pr, runs, range.newCommitMessages);
  const ciShas = ciShasOf(commits, pr.headSha, judged);

  return (
    blockedPush(decision, headChecks) ?? {
      ...decision,
      ...{ sinceSha: range.sinceSha, judged, ciShas },
    }
  );
}

function ciShasOf(
  commits: readonly PullCommit[],
  headSha: string | undefined,
  judged: string | undefined,
) {
  return {
    head: ciJudgedSha(commits) ?? headSha,
    judged: ciShaAt(commits, judged),
  };
}

/** No re-check when the push earned none, or when Lore's verdict, a carried approval among them, already stands on the head. */
function blockedPush(
  decision: { start: boolean; reason: string },
  headChecks: readonly CheckRun[],
): RecheckPlan | null {
  if (!decision.start) {
    return decision;
  }

  return loreReviewVerdict(headChecks) === "none"
    ? null
    : { start: false, reason: VERDICT_STANDS };
}

const VERDICT_STANDS = "Lore's verdict already stands on this sha";

/** The commit CI judged at `sha`: the newest at or before it that did not skip CI, or `sha` itself when the branch no longer has it. */
function ciShaAt(
  commits: readonly PullCommit[],
  sha: string | undefined,
): string | undefined {
  const at = commits.findIndex((commit) => commit.sha === sha);

  return at < 0 ? sha : (ciJudgedSha(commits.slice(0, at + 1)) ?? sha);
}

function pushDecision(
  pr: Pick<PullRef, "headSha">,
  runs: RunView[],
  newCommitMessages: string[],
) {
  return decideRecheck({
    headSha: pr.headSha,
    openReviewShas: runs.filter(isOpen).flatMap(headShaOf),
    judgedShas: judgedShas(runs),
    newCommitMessages,
  });
}

/** Why the re-check waits for CI, read on the commits the plan named; null when it may start. */
export async function ciHold(
  pulls: RecheckReads,
  { ciShas = {} }: RecheckPlan,
): Promise<string | null> {
  const [head, before] = await Promise.all([
    ciShas.head ? pulls.listChecks(ciShas.head) : [],
    ciShas.judged ? pulls.listChecks(ciShas.judged) : [],
  ]);

  return recheckWaitsForCi(head, before);
}

/** Why a re-check waits for CI, or null when it may start: green CI, or no CI at all in a repository whose judged commit carried none. CI that has not started yet, in a repository that runs it, waits like CI still running. */
export function recheckWaitsForCi(
  headChecks: readonly CheckRun[],
  judgedChecks: readonly CheckRun[],
): string | null {
  const ci = ciConclusionOf(externalCheckRuns(headChecks));

  if (ci === "pending") {
    return "CI is still running on the head";
  }

  if (ci === "failure") {
    return "CI is red on the head; the push that fixes it is re-checked";
  }

  return ci === "none" && externalCheckRuns(judgedChecks).length > 0
    ? "CI has not started on the head yet"
    : null;
}
