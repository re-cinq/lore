import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
} from "@re-cinq/lore-shared";
import {
  explainFailedChecks,
  loreCheckName,
} from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type { CheckRun } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { decidePrReady } from "./decide-ready.js";
import {
  decideCiReady,
  redFeedback,
  type CiCheckVerdict,
} from "./decide-ci.js";
import {
  LOOP_BLUEPRINT,
  type LoopRunSlice,
  type ParkedReport,
  type PrReadyCheckDeps,
} from "./sweep-contract.js";

/** The end-of-line wait: CI plus review threads. All four reads run together — they are independent, and this job sweeps every parked run on a tick. */
export async function prReportForRun(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<ParkedReport | null> {
  const judged = await judgeable(run, deps);

  if (!judged) {
    return null;
  }
  const evidence = await prEvidence(run, deps, judged);

  return parkedReport(
    decidePrReady({
      ci: ciConclusionOf(evidence.checks),
      threads: evidence.threads,
      openReviewRunCount: evidence.openReviewRunCount,
      hasCiHistory: evidence.hasCiHistory,
      mergeable: evidence.mergeable,
      behindBy: evidence.behindBy,
    }),
    (reason) =>
      reason === "ci_red" ? redFeedback(evidence.checks, judged.headSha) : {},
  );
}

/** The six independent reads a settled pull request is judged on, together — this job sweeps every parked run on a tick. */
async function prEvidence(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
  judged: { prNumber: number; headSha: string },
) {
  const [
    checks,
    threads,
    openReviewRunCount,
    hasCiHistory,
    mergeable,
    behindBy,
  ] = await Promise.all([
    deps.listChecks(run.repo, judged.headSha),
    deps.listReviewThreads(run.repo, judged.prNumber),
    deps.countOpenReviewRuns(run.repo, judged.prNumber),
    deps.hasCiHistory(run.repo),
    deps.prMergeable(run.repo, judged.prNumber),
    deps.prBehindBy(run.repo, judged.prNumber),
  ]);

  return {
    checks: await explainedChecks(run.repo, withoutOwnCheck(checks), deps),
    threads,
    openReviewRunCount,
    hasCiHistory,
    mergeable,
    behindBy,
  };
}

/** A verdict as the parked node hears it: ready, blocked with its reason and what the fix needs, or nothing while the pull request is still moving. */
export async function parkedReport(
  verdict:
    | { kind: "ready" }
    | { kind: "wait" }
    | { kind: "blocked"; reason: string; outcome: ParkedReport["outcome"] },
  feedback: (
    reason: string,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<ParkedReport | null> {
  if (verdict.kind === "ready") {
    return { outcome: "success", args: {} };
  }

  if (verdict.kind === "wait") {
    return null;
  }

  return {
    outcome: verdict.outcome,
    args: { reason: verdict.reason, ...(await feedback(verdict.reason)) },
  };
}

/** The per-round wait: CI alone decides, and only the checks the repo itself publishes count — a run must not wait on the review check Lore has not started while the PR is still a draft. */
export async function ciReportForRun(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<ParkedReport | null> {
  const judged = await judgeable(run, deps);
  const evidence = await ciEvidence(run, deps, judged);
  const verdict = decideCiReady({
    ...evidence,
    judgedSha: judged?.headSha ?? null,
    lastReportedSha: lastReportedSha(run.args),
  });

  return ciReport(verdict);
}

/** What a round is judged on: the repo's own checks, whether it runs CI at all, and whether GitHub will build the PR. The three are independent reads and go together. */
async function ciEvidence(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
  judged: { headSha: string } | null,
) {
  const prNumber = Number(run.args.pr_number) || 0;
  const [checks, hasCiHistory, mergeable] = await Promise.all([
    judged ? deps.listChecks(run.repo, judged.headSha) : [],
    deps.hasCiHistory(run.repo),
    prNumber ? deps.prMergeable(run.repo, prNumber) : null,
  ]);
  const external = externalCheckRuns(checks);

  return {
    checks: await explainedChecks(run.repo, external, deps),
    hasCiHistory,
    mergeable,
  };
}

/** The loop's own status check is in progress for as long as the run is, so a wait that counted it would wait on itself forever. The review checks stay: waiting on those is the point. */
function withoutOwnCheck(checks: CheckRun[]): CheckRun[] {
  const own = loreCheckName(LOOP_BLUEPRINT);

  return checks.filter((run) => run.name !== own);
}

/** The shared explainer, bound to this sweep's job reader. */
export function explainedChecks(
  repo: string,
  checks: CheckRun[],
  deps: Pick<PrReadyCheckDeps, "failedJob">,
): Promise<CheckRun[]> {
  return explainFailedChecks(checks, (jobId) => deps.failedJob(repo, jobId));
}

/** The round verdict as the parked node hears it; a wait is silence. */
function ciReport(verdict: CiCheckVerdict): ParkedReport | null {
  if (verdict.kind === "wait") {
    return null;
  }

  return verdict.kind === "ready"
    ? { outcome: "success", args: {} }
    : {
        outcome: verdict.outcome,
        args: { reason: verdict.reason, ...verdict.feedback },
      };
}

/** The sha a red verdict was last reported for on this run, from its args. */
function lastReportedSha(args: Record<string, unknown>): string | null {
  const sha = args.ci_feedback_sha;

  return typeof sha === "string" && sha.length > 0 ? sha : null;
}

// The PR this run is parked on, and the commit to judge it by — or null when there is nothing to judge. A run with no `pr_number` never got that far; a PR with no judgeable commit has nothing CI was ever going to check.
export async function judgeable(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<{ prNumber: number; headSha: string } | null> {
  const prNumber = Number(run.args.pr_number) || 0;

  if (!prNumber) {
    console.log(
      `[pr-ready-check] run ${run.id} parked with no pr_number — skipped`,
    );

    return null;
  }
  const headSha = ciJudgedSha(await deps.listPrCommits(run.repo, prNumber));

  return headSha ? { prNumber, headSha } : null;
}
