// The auto-merge loop's wait (specs/protected-branch-merge): what a pull request is judged on before Lore approves and merges it, and what a fix is handed when it is not ready.
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
} from "@re-cinq/lore-shared";
import { loreReviewVerdict } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type {
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { redFeedback } from "./decide-ci.js";
import {
  decideMergeReady,
  type MergeReadyVerdict,
} from "./decide-merge-ready.js";
import { explainedChecks } from "./park-readers.js";
import type {
  LoopRunSlice,
  ParkedReport,
  PrReadyCheckDeps,
} from "./sweep-contract.js";

/** The reads only the auto-merge wait makes, beside the sweep's own. */
export interface MergeWaitReads {
  /** When the pull request was opened, and whether it conflicts with its base. */
  pullFacts(
    repo: string,
    number: number,
  ): Promise<{ createdAt: string | null; mergeable: boolean | null }>;
  listReviewComments(repo: string, number: number): Promise<ReviewComment[]>;
  /** The body of the newest review that says something: what a review that asked for changes without a line comment asked. */
  latestReviewBody(repo: string, number: number): Promise<string | null>;
  minAgeHours(repo: string): Promise<number>;
  now(): number;
}

export type MergeWaitDeps = Pick<
  PrReadyCheckDeps,
  | "listPrCommits"
  | "listChecks"
  | "failedJob"
  | "hasCiHistory"
  | "listReviewThreads"
  | "countOpenReviewRuns"
> &
  MergeWaitReads;

const HOUR_MS = 60 * 60 * 1000;

export async function mergeReportForRun(
  run: LoopRunSlice,
  deps: MergeWaitDeps,
): Promise<ParkedReport | null> {
  const prNumber = Number(run.args.pr_number) || 0;
  const headSha = ciJudgedSha(await deps.listPrCommits(run.repo, prNumber));

  if (!prNumber || !headSha) {
    return null;
  }
  const evidence = await mergeEvidence(run, deps, { prNumber, headSha });
  const verdict = decideMergeReady(evidence.input);

  return reportOf(verdict, () => feedbackOf(deps, run, evidence));
}

type Evidence = Awaited<ReturnType<typeof mergeEvidence>>;

async function mergeEvidence(
  run: LoopRunSlice,
  deps: MergeWaitDeps,
  { prNumber, headSha }: { prNumber: number; headSha: string },
) {
  const [checks, threads, openReviewRuns, hasCiHistory, facts, minAgeHours] =
    await Promise.all([
      deps.listChecks(run.repo, headSha),
      deps.listReviewThreads(run.repo, prNumber),
      deps.countOpenReviewRuns(run.repo, prNumber),
      deps.hasCiHistory(run.repo),
      deps.pullFacts(run.repo, prNumber),
      deps.minAgeHours(run.repo),
    ]);
  const ci = await explainedChecks(run.repo, externalCheckRuns(checks), deps);
  const open = openThreads(threads);

  return {
    prNumber,
    headSha,
    ci,
    open,
    input: {
      mergeable: facts.mergeable,
      ci: ciConclusionOf(ci),
      hasCiHistory,
      judgedSha: headSha,
      lastRedSha: stringArg(run.args.ci_feedback_sha),
      unresolvedThreads: open.length,
      openReviewRuns,
      review: loreReviewVerdict(checks),
      ageHours: ageHours(facts.createdAt, deps.now()),
      minAgeHours,
    },
  };
}

function openThreads(threads: readonly ReviewThread[]): ReviewThread[] {
  return threads.filter((t) => !t.isResolved && !t.isOutdated);
}

/** A pull request whose opening time GitHub did not answer is treated as old enough: the age guards against merging too soon, not against a read that failed. */
function ageHours(createdAt: string | null, now: number): number {
  return createdAt ? (now - Date.parse(createdAt)) / HOUR_MS : Infinity;
}

function stringArg(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The parked node hears ready, a blocked reason with what the fix needs, or nothing while the pull request is still moving. */
async function reportOf(
  verdict: MergeReadyVerdict,
  feedback: (reason: string) => Promise<Record<string, unknown>>,
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

/** Red CI rides as the failed checks; open threads and a review's request ride as review feedback, the text the fix answers. */
async function feedbackOf(
  deps: MergeWaitDeps,
  run: LoopRunSlice,
  evidence: Evidence,
): Promise<Record<string, unknown>> {
  if (evidence.input.ci === "failure") {
    return { ...redFeedback(evidence.ci, evidence.headSha) };
  }
  const review = await reviewFeedback(deps, run, evidence);

  return review ? { review_feedback: review } : {};
}

async function reviewFeedback(
  deps: MergeWaitDeps,
  run: LoopRunSlice,
  { prNumber, open }: Evidence,
): Promise<string | null> {
  if (open.length === 0) {
    return deps.latestReviewBody(run.repo, prNumber);
  }
  const comments = await deps.listReviewComments(run.repo, prNumber);

  return open
    .map((thread) => threadText(thread, comments))
    .filter((text) => text !== null)
    .join("\n\n");
}

/** One open thread as the fix agent reads it: the comment that opened it, which is the one its reply goes under. */
function threadText(
  thread: ReviewThread,
  comments: readonly ReviewComment[],
): string | null {
  const rootId = thread.comments[0]?.databaseId;
  const root = comments.find((c) => c.id === rootId);

  if (!root) {
    return null;
  }
  const at = root.line === null ? root.path : `${root.path}:${root.line}`;

  return `inline comment ${root.id} on ${at} (${root.user}):\n${root.body}`;
}
