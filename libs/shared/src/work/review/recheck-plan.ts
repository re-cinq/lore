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
}

export async function planRecheck(
  pulls: RecheckReads,
  pr: Pick<PullRef, "number" | "headSha">,
  runs: RunView[],
): Promise<RecheckPlan> {
  const commits = await pulls.listCommits(pr.number);
  const judged = lastJudgedSha(runs);
  const range = rangeSince(commits, judged);
  const decision = pushDecision(pr, runs, range.newCommitMessages);

  if (!decision.start) {
    return decision;
  }
  const ciSha = ciJudgedSha(commits) ?? pr.headSha;
  const held = await ciHold(pulls, ciSha, judged);

  return held
    ? { start: false, reason: held }
    : { ...decision, sinceSha: range.sinceSha, judged };
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

async function ciHold(
  pulls: RecheckReads,
  ciSha: string | undefined,
  judged: string | undefined,
): Promise<string | null> {
  const [head, before] = await Promise.all([
    ciSha ? pulls.listChecks(ciSha) : [],
    judged ? pulls.listChecks(judged) : [],
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
