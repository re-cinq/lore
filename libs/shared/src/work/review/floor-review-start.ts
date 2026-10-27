// Starting the code-review lines on the external floor: what a pull request's lifecycle asks of it, decided here and started through the floor's API. `lines.start` answers whether the run was joined, which is what keeps the announcement from being posted twice.
import type { FloorClient, Item, StartedRun } from "@re-cinq/floor-client";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type {
  PullCommit,
  PullRef,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  judgeRebase,
  scopeAfterRebase,
  type CarryChecks,
  type CarryReads,
} from "./carry-approval.js";
import {
  ciHold,
  planRecheck,
  type RecheckPlan,
  type RecheckReads,
} from "./recheck-plan.js";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  pullRequestUrl,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { linkedIssueNumber } from "../../domain/pr-body.js";
import {
  decideReviewOnOpen,
  decideReviewOnReply,
  recheckDescription,
  reviewDescription,
  reviewGateOpen,
} from "./code-review-decisions.js";
import {
  FLOOR_REVIEW_LINES,
  RECHECK_LINE,
  REPLY_LINE,
  REVIEW_LINE,
  hasReviewedPr,
  headShaOf,
  isOpen,
  reviewRunsForPr,
} from "./floor-review-runs.js";
import { startLine } from "./floor-line-start.js";
import { REVIEW_HELP } from "./review-summary.js";
import {
  openThreadsItem,
  readRecheckHandOff,
  type OpenFindingsReads,
} from "./lore-review.js";

export interface ReviewFloor {
  lines: Pick<FloorClient["lines"], "start">;
  runs: Pick<FloorClient["runs"], "list" | "cancel">;
  blobs: Pick<FloorClient["blobs"], "put">;
}

export interface ReviewPulls
  extends OpenFindingsReads, CarryReads, RecheckReads {
  get(number: number): Promise<PullRef | null>;
  comment(number: number, body: string): Promise<void>;
  listCommits(number: number): Promise<PullCommit[]>;
}

export interface ReviewIssues {
  get(number: number): Promise<IssueRef | null>;
}

export interface ReviewStartDeps {
  floor: ReviewFloor;
  pulls: ReviewPulls;
  issues: ReviewIssues;
  checks: CarryChecks;
  uiUrl?: string;
  loreAppLogin?: string;
}

export interface PullRequestTarget {
  repo: string;
  prNumber: number;
  autoReview: boolean;
}

export interface StartReviewInput extends PullRequestTarget {
  forced?: boolean;
}

export interface StartReplyInput extends PullRequestTarget {
  reviewId: number;
  reviewAuthor: string;
}

/** A pull request opened or pushed to: the first pass is the deep review, every later push a re-check. */
export async function reviewOrRecheck(
  deps: ReviewStartDeps,
  target: PullRequestTarget,
): Promise<string | null> {
  const reviewed = await hasReviewedPr(deps.floor, target);

  return reviewed ? startRecheck(deps, target) : startReview(deps, target);
}

export async function startReview(
  deps: ReviewStartDeps,
  input: StartReviewInput,
): Promise<string | null> {
  const pr = await deps.pulls.get(input.prNumber);

  const gate = { ...input, loreAppLogin: deps.loreAppLogin };

  if (!pr || !reviewGateOpen(pr, gate)) {
    return null;
  }
  await retireRechecks(deps.floor, input);
  const started = await startReviewLine(deps, input, pr);

  if (!started.joined) {
    await announceReview(deps, input.prNumber, started.run.id);
  }

  return started.run.id;
}

/** A person asking for a review by hand supersedes the fast pass a push started: left open it would post a second, shallower verdict on the same sha. A re-check of a newer sha supersedes the open one the same way (`supersedeAndRecheck`). */
async function retireRechecks(
  floor: ReviewFloor,
  input: StartReviewInput,
): Promise<void> {
  if (input.forced) {
    await cancelOpenRuns(floor, input, [RECHECK_LINE], "superseded");
  }
}

async function startReviewLine(
  deps: ReviewStartDeps,
  input: StartReviewInput,
  pr: PullRef,
): Promise<StartedRun> {
  const { floor } = deps;
  const description = reviewDescription(input.repo, input.prNumber, pr.branch);

  return startLine(floor.lines, REVIEW_LINE, {
    repo: floorRepoOf(input.repo),
    startItems: await reviewItems(deps, pr, description),
  });
}

export async function startRecheck(
  deps: ReviewStartDeps,
  target: PullRequestTarget,
): Promise<string | null> {
  const pr = await deps.pulls.get(target.prNumber);

  const { loreAppLogin } = deps;

  if (!decideReviewOnOpen({ ...target, pr, loreAppLogin }).start) {
    return null;
  }
  const runs = await reviewRunsForPr(deps.floor, target);
  const plan = await planRecheck(deps.pulls, pr!, runs);

  return plan.start
    ? carryOrRecheck(deps, target, pr!, plan)
    : skipped(target.prNumber, plan.reason);
}

/** A rebase that changed nothing Lore approved keeps the approval and starts nothing, whatever CI is doing; anything else waits for green CI, then is re-checked on the files a rebase changed or the range since the last verdict. */
async function carryOrRecheck(
  deps: ReviewStartDeps,
  target: PullRequestTarget,
  pr: PullRef,
  plan: RecheckPlan,
): Promise<string | null> {
  const { judged, sinceSha } = plan;
  const rebase = await judgeRebase(deps, pr, judged, sinceSha);
  const held =
    "carried" in rebase ? rebase.carried : await ciHold(deps.pulls, plan);

  if (held) {
    return skipped(target.prNumber, held);
  }
  const scope = scopeAfterRebase(rebase, judged, pr.baseBranch ?? "main");

  return supersedeAndRecheck(deps, target, pr, { sinceSha, scope });
}

/** An open re-check of an older sha is judging code the branch no longer has, and its verdict would land beside the new one. One already judging the head sha is left alone: two deliveries of the same push can reach here together, and the second must join the first, not cancel it. */
async function supersedeAndRecheck(
  deps: ReviewStartDeps,
  target: PullRequestTarget,
  pr: PullRef,
  range: RecheckRange,
): Promise<string> {
  const { floor } = deps;
  const runs = await reviewRunsForPr(floor, target);
  const older = runs.filter(
    (run) =>
      isOpen(run) &&
      run.lineId === RECHECK_LINE &&
      !headShaOf(run).includes(pr.headSha ?? ""),
  );

  await Promise.all(
    older.map((run) => floor.runs.cancel(run.id, "superseded")),
  );

  return startRecheckLine(deps, target, pr, range);
}

/** A submitted request-changes review starts a reply; the line's own `read-review` station gathers what the review said, and the agent decides per comment whether it asks for a change or an answer. */
export async function startReply(
  deps: ReviewStartDeps,
  input: StartReplyInput,
): Promise<string | null> {
  const { floor, pulls } = deps;
  const pr = await pulls.get(input.prNumber);
  const commentAuthor = input.reviewAuthor;

  if (!decideReviewOnReply({ ...input, pr, commentAuthor }).start) {
    return null;
  }
  const started = await startLine(floor.lines, REPLY_LINE, {
    repo: floorRepoOf(input.repo),
    startItems: {
      ...(await pullRequestItems(deps, pr!)),
      review_id: valueItem(input.reviewId),
    },
  });

  return started.run.id;
}

/** A closed pull request ends every review-family run still open on it. */
export function closeReviewsForPr(
  floor: ReviewFloor,
  target: Pick<PullRequestTarget, "repo" | "prNumber">,
): Promise<string[]> {
  return cancelOpenRuns(floor, target, FLOOR_REVIEW_LINES, "pr_closed");
}

async function cancelOpenRuns(
  floor: ReviewFloor,
  target: Pick<PullRequestTarget, "repo" | "prNumber">,
  lines: readonly string[],
  reason: string,
): Promise<string[]> {
  const runs = await reviewRunsForPr(floor, target);
  const open = runs.filter((run) => isOpen(run) && lines.includes(run.lineId));

  await Promise.all(open.map((run) => floor.runs.cancel(run.id, reason)));

  return open.map((run) => run.id);
}

/** What a re-check judges: the commits since the sha its last verdict judged, or after a rebase the files whose change differs. */
interface RecheckRange {
  sinceSha?: string;
  scope: string;
}

async function startRecheckLine(
  deps: ReviewStartDeps,
  target: PullRequestTarget,
  pr: PullRef,
  { sinceSha, scope }: RecheckRange,
): Promise<string> {
  const handOff = await readRecheckHandOff(deps.pulls, target.prNumber);
  const { repo, prNumber } = target;
  const description = `${recheckDescription(repo, prNumber, pr.branch, sinceSha)}${scope}${handOff.brief}`;
  const { floor } = deps;
  const started = await startLine(floor.lines, RECHECK_LINE, {
    repo: floorRepoOf(target.repo),
    startItems: {
      ...(await reviewItems(deps, pr, description)),
      ...openThreadsItem(handOff.threadIds),
    },
  });

  return started.run.id;
}

async function reviewItems(
  deps: ReviewStartDeps,
  pr: PullRef,
  description: string,
): Promise<Record<string, Item>> {
  return {
    ...(await pullRequestItems(deps, pr)),
    description: valueItem(description),
    ...(pr.headSha ? { head_sha: valueItem(pr.headSha) } : {}),
  };
}

/** What every review-family line is started with: the branch to clone, the pull request, and the issue it answers when it names one. */
async function pullRequestItems(
  deps: ReviewStartDeps,
  pr: PullRef,
): Promise<Record<string, Item>> {
  const issue = await linkedIssueItem(deps, pr);

  return {
    repo: gitItem(pr.repo, pr.branch),
    pr_url: valueItem(pullRequestUrl(pr.repo, pr.number)),
    ...(issue ? { issue } : {}),
  };
}

/** The linked issue's text as a file: an issue body is too long for a value, and a pull request that names no issue simply starts without one. */
async function linkedIssueItem(
  deps: ReviewStartDeps,
  pr: PullRef,
): Promise<Item | null> {
  const { floor, issues } = deps;
  const issueNumber = linkedIssueNumber(pr.body);
  const issue = issueNumber ? await issues.get(issueNumber) : null;

  if (!issue) {
    return null;
  }
  const stored = await floor.blobs.put(
    new TextEncoder().encode(issueMarkdown(issue)),
    "text/markdown",
  );

  return fileItem(stored.hash);
}

export function issueMarkdown(issue: IssueRef): string {
  return `# ${issue.title} (#${issue.number})\n\n${issue.body ?? ""}\n`;
}

async function announceReview(
  deps: ReviewStartDeps,
  prNumber: number,
  runId: string,
): Promise<void> {
  const { pulls, uiUrl } = deps;

  await pulls.comment(
    prNumber,
    `Lore is reviewing this PR — ${runLink(runId, uiUrl)}.\n\n${REVIEW_HELP}`,
  );
}

function runLink(runId: string, uiUrl?: string): string {
  return uiUrl
    ? `[${runId}](${uiUrl.replace(/\/+$/, "")}/assembly-runs/${runId})`
    : runId;
}

/** Says why this push gets no pass of its own, where a silent null would read as a dropped event. */
function skipped(prNumber: number, reason: string): null {
  console.log(`[code-review] PR #${prNumber}: no re-check — ${reason}`);

  return null;
}
