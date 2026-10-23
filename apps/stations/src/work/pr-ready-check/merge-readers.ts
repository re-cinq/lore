// The auto-merge loop's wait (specs/protected-branch-merge): what a pull request is judged on before Lore approves and merges it, and what a fix is handed when it is not ready.
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
  type Project,
} from "@re-cinq/lore-shared";
import { autoMergeMinAgeHours } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreReviewVerdict } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type {
  CheckRun,
  PullRef,
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { redFeedback, type CiFeedbackArgs } from "./decide-ci.js";
import {
  decideMergeReady,
  type MergeReadyInput,
} from "./decide-merge-ready.js";
import { explainedChecks, parkedReport } from "./park-readers.js";
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

  return parkedReport(verdict, () => feedbackOf(deps, run, evidence));
}

type Evidence = Awaited<ReturnType<typeof mergeEvidence>>;

async function mergeEvidence(
  run: LoopRunSlice,
  deps: MergeWaitDeps,
  pr: { prNumber: number; headSha: string },
) {
  const read = await readMergeFacts(run.repo, deps, pr);
  const ci = await explainedChecks(
    run.repo,
    externalCheckRuns(read.checks),
    deps,
  );
  const open = openThreads(read.threads);

  return {
    ...pr,
    ci,
    open,
    input: decisionInput(run, deps, { read, ci, open, headSha: pr.headSha }),
  };
}

type MergeFacts = Awaited<ReturnType<typeof readMergeFacts>>;

interface JudgedPull {
  read: MergeFacts;
  ci: CheckRun[];
  open: ReviewThread[];
  headSha: string;
}

function decisionInput(
  run: LoopRunSlice,
  deps: Pick<MergeWaitDeps, "now">,
  { read, ci, open, headSha }: JudgedPull,
): MergeReadyInput {
  return {
    mergeable: read.facts.mergeable,
    ci: ciConclusionOf(ci),
    hasCiHistory: read.hasCiHistory,
    judgedSha: headSha,
    lastRedSha: stringArg(run.args.ci_feedback_sha),
    unresolvedThreads: open.length,
    openReviewRuns: read.openReviewRuns,
    review: loreReviewVerdict(read.checks),
    ageHours: ageHours(read.facts.createdAt, deps.now()),
    minAgeHours: read.minAgeHours,
  };
}

async function readMergeFacts(
  repo: string,
  deps: MergeWaitDeps,
  { prNumber, headSha }: { prNumber: number; headSha: string },
) {
  const [checks, threads, openReviewRuns, hasCiHistory, facts, minAgeHours] =
    await Promise.all([
      deps.listChecks(repo, headSha),
      deps.listReviewThreads(repo, prNumber),
      deps.countOpenReviewRuns(repo, prNumber),
      deps.hasCiHistory(repo),
      deps.pullFacts(repo, prNumber),
      deps.minAgeHours(repo),
    ]);

  return { checks, threads, openReviewRuns, hasCiHistory, facts, minAgeHours };
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

/** Red CI rides as the failed checks; open threads and a review's request ride as review feedback, the text the fix answers. */
async function feedbackOf(
  deps: MergeWaitDeps,
  run: LoopRunSlice,
  evidence: Evidence,
): Promise<Record<string, unknown>> {
  if (evidence.input.mergeable === false) {
    return { ...conflictFeedback(evidence.headSha) };
  }

  if (evidence.input.ci === "failure") {
    return { ...redFeedback(evidence.ci, evidence.headSha) };
  }
  const review = await reviewFeedback(deps, run, evidence);

  return review ? { review_feedback: review } : {};
}

export const CONFLICT_SUMMARY =
  "GitHub reports the branch conflicts with its base, so no CI ran on it. Merge the base branch in, settle every conflict and push.";

/** A conflicting pull request gets no CI at all; the fix still has to be told what to do. */
function conflictFeedback(headSha: string): CiFeedbackArgs {
  return {
    ci_feedback_sha: headSha,
    ci_failed_checks: "merge conflict with the base branch",
    ci_failure_summary: CONFLICT_SUMMARY,
  };
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
  const opening = thread.comments.at(0);
  const rootId = opening?.databaseId;
  const root = comments.find((c) => c.id === rootId);

  if (!root) {
    return null;
  }
  const at = root.line === null ? root.path : `${root.path}:${root.line}`;

  return `inline comment ${root.id} on ${at} (${root.user}):\n${root.body}`;
}

type MergeProjectOf = (
  repo: string,
) => Promise<Pick<Project, "pulls" | "settings">>;

/** The reads only the auto-merge wait makes, through the sweep's per-repo cache. */
export function mergeReads(projectOf: MergeProjectOf): MergeWaitReads {
  return {
    pullFacts: async (repo, number) =>
      pullFactsOf(await (await projectOf(repo)).pulls.get(number)),
    listReviewComments: async (repo, number) =>
      (await projectOf(repo)).pulls.listComments(number),
    latestReviewBody: async (repo, number) =>
      latestBody(await (await projectOf(repo)).pulls.listReviews(number)),
    minAgeHours: async (repo) =>
      autoMergeMinAgeHours(
        await (await projectOf(repo)).settings.rawSettings(),
      ),
    now: () => Date.now(),
  };
}

function pullFactsOf(pull: Pick<PullRef, "createdAt" | "mergeable"> | null): {
  createdAt: string | null;
  mergeable: boolean | null;
} {
  return {
    createdAt: pull?.createdAt ?? null,
    mergeable: pull?.mergeable ?? null,
  };
}

function latestBody(reviews: readonly { body: string }[]): string | null {
  return reviews.findLast((review) => review.body.trim() !== "")?.body ?? null;
}
