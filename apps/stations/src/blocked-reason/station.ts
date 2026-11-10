// The blocked-reason station: on every GitHub event that can change why a Lore PR is not merging, it derives the reason again and, only when it changed, records it, audits it and edits the one comment on the PR and on its backlog issue (specs/protected-branch-merge).

import { loreTaskIdOf } from "@re-cinq/lore-shared";
import type { BlockedReason } from "@re-cinq/lore-shared/blocked-reason.js";
import { codeownersOf, ownedPaths } from "@re-cinq/lore-shared/codeowners.js";
import type { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import type { AppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import type { PrBlockedReasonsPort } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-port.js";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { RepoFiles } from "@re-cinq/lore-shared/project/repo/repo-files.js";
import {
  dependentOpenPulls,
  resolveBlockingDependency,
  type PullReader,
  type TaskGroupRef,
} from "../outbound/task-ordering.js";
import { announceReason, type CommentThread } from "./comment.js";
import {
  approvalCount,
  approvers,
  deriveBlockedReason,
  type PullState,
} from "./derivation.js";

export type { TaskGroupRef };

export interface ReasonEvent {
  name: string;
  params: Readonly<Record<string, unknown>>;
}

type ReasonPulls = Pick<
  PullRequests,
  | "get"
  | "list"
  | "getMergeability"
  | "getBranchRule"
  | "listChecks"
  | "ciConclusion"
  | "listReviews"
  | "listFiles"
>;

export interface BlockedReasonProject {
  pulls: ReasonPulls;
  /** The PR's conversation and its backlog issue's: both are issue comments on GitHub. */
  issues: CommentThread;
  /** The default branch's files: where GitHub reads CODEOWNERS from. */
  repo: Pick<RepoFiles, "read">;
  audit: Pick<Audit, "write" | "recorded">;
  taskIssue(taskId: string): Promise<number | null>;
  autoMergeOn(): Promise<boolean>;
  taskGroup?(prNumber: number): Promise<TaskGroupRef | undefined>;
  hasReviewInFlight?(prNumber: number): Promise<boolean>;
  getTaskDependsOn?(taskId: string): Promise<string[]>;
  getTaskPr?(taskId: string): Promise<number | null>;
}

export interface BlockedReasonDeps {
  project(repo: string): Promise<BlockedReasonProject>;
  reasons: PrBlockedReasonsPort;
  appLogin: AppLogin;
}

interface RepoScope {
  repo: string;
  project: BlockedReasonProject;
  reasons: PrBlockedReasonsPort;
}

export async function runBlockedReason(
  event: ReasonEvent,
  deps: BlockedReasonDeps,
): Promise<string> {
  const login = await deps.appLogin();

  if (!login) {
    return "no Lore App login: no PR is Lore's";
  }
  const scope = { repo: String(event.params.repo ?? ""), login, deps };

  if (event.name === "github.pull_request.closed") {
    return closePulls(scope, event.params);
  }

  if (event.name === "lore.pull_request.merge_refused") {
    return handleMergeRefused(scope, event.params);
  }

  return refreshWatched(event, scope);
}

interface ClosedScope {
  repo: string;
  login: string;
  deps: BlockedReasonDeps;
}

/** A closed PR's row is stamped closed; one Lore never recorded has no row, so stamping needs no author. A merge is audited for Lore's PRs only, and dependent open PRs are re-evaluated. */
async function closePulls(
  scope: ClosedScope,
  params: ReasonEvent["params"],
): Promise<string> {
  const { repo, deps } = scope;
  const numbers = pullNumbersIn(params);

  await Promise.all(numbers.map((n) => deps.reasons.close(repo, n)));
  const closed = numbers.map((n) => `#${n} closed`);
  const merges =
    params.merged === true ? await settleMergedPulls(scope, numbers) : [];

  return [...closed, ...merges].join("; ");
}

async function settleMergedPulls(
  { repo, login, deps }: ClosedScope,
  numbers: number[],
): Promise<string[]> {
  const project = await deps.project(repo);
  const audited = await Promise.all(
    numbers.map((n) => auditMerge(project, login, n)),
  );
  const refreshed = await refreshDependents(
    { repo, project, reasons: deps.reasons },
    login,
    numbers,
  );

  return [...audited, ...refreshed];
}

async function refreshDependents(
  scope: RepoScope,
  login: string,
  closedNumbers: number[],
): Promise<string[]> {
  const { project } = scope;

  if (!project.getTaskDependsOn) {
    return [];
  }
  const [closedPulls, openPulls, everyAuthor] = await Promise.all([
    Promise.all(closedNumbers.map((n) => project.pulls.get(n))),
    project.pulls.list(),
    project.autoMergeOn(),
  ]);
  const candidates = openPulls.filter(
    (pr) => (everyAuthor || pr.author === login) && awaitsMerge(pr),
  );
  const dependents = await dependentOpenPulls(project, candidates, closedPulls);

  return Promise.all(dependents.map((pr) => refresh(scope, pr)));
}

/** The `pr_merged` row the KPI view counts; a redelivered close finds it written and writes no second one. */
async function auditMerge(
  project: BlockedReasonProject,
  login: string,
  number: number,
): Promise<string> {
  const pr = await project.pulls.get(number);

  if (pr?.author !== login) {
    return `#${number} not Lore's`;
  }

  if (await project.audit.recorded("pr_merged", { prNumber: number })) {
    return `#${number} merge already audited`;
  }
  await writeMerge(project, pr);

  return `#${number} merge audited`;
}

async function writeMerge(
  { pulls, repo, audit }: BlockedReasonProject,
  pr: PullRef,
): Promise<void> {
  const taskId = loreTaskIdOf(pr.body);
  const [files, reviews, codeowners] = await Promise.all([
    pulls.listFiles(pr.number),
    pulls.listReviews(pr.number),
    codeownersOf(repo),
  ]);
  const payload = {
    prNumber: pr.number,
    mergedAt: pr.mergedAt ?? null,
    taskId,
    sensitivePaths: ownedPaths(files, codeowners),
    approvedBy: approvers(reviews),
  };

  await audit.write({ event_type: "pr_merged", task_id: taskId, payload });
}

function pullNumbersIn(params: ReasonEvent["params"]): number[] {
  const listed = Array.isArray(params.pr_numbers) ? params.pr_numbers : [];

  return [params.pr_number, ...listed].filter(
    (n): n is number => typeof n === "number",
  );
}

async function refreshWatched(
  event: ReasonEvent,
  { repo, login, deps }: ClosedScope,
): Promise<string> {
  const project = await deps.project(repo);
  const pulls = await watchedPulls(event, project, login);
  const scope = { repo, project, reasons: deps.reasons };
  const outcomes = await Promise.all(pulls.map((pr) => refresh(scope, pr)));

  return outcomes.join("; ") || "no Lore PR to read";
}

/** The open, non-draft PRs this event concerns that Lore's App opened, or any author's where the auto-merge loop is on: a push concerns every open PR based on the pushed branch. */
async function watchedPulls(
  event: ReasonEvent,
  { pulls, autoMergeOn }: Pick<BlockedReasonProject, "pulls" | "autoMergeOn">,
  login: string,
): Promise<PullRef[]> {
  const concerned =
    event.name === "github.push"
      ? (await pulls.list()).filter(
          (pr) => pr.baseBranch === event.params.branch,
        )
      : await Promise.all(pullNumbersIn(event.params).map((n) => pulls.get(n)));
  const everyAuthor = await autoMergeOn();

  return concerned.filter(
    (pr): pr is PullRef =>
      pr !== null && (everyAuthor || pr.author === login) && awaitsMerge(pr),
  );
}

/** A draft is still being written, not waiting to merge: the loop pushes to it many times, and a reason on it would only be noise. */
const awaitsMerge = (pr: PullRef): boolean =>
  pr.state === "open" && pr.draft !== true;

async function refresh(scope: RepoScope, pr: PullRef): Promise<string> {
  const blocked = await resolveBlockedReason(scope.project, pr);

  await scope.reasons.resetUnclassifiedRefusals(scope.repo, pr.number);

  return applyReason(scope, pr, blocked);
}

async function applyReason(
  scope: RepoScope,
  pr: Pick<PullRef, "number" | "body">,
  blocked: BlockedReason | null,
): Promise<string> {
  const { repo, project, reasons } = scope;
  const current = await reasons.current(repo, pr.number);

  if (sameReason(current, blocked)) {
    return `#${pr.number} unchanged`;
  }
  await (blocked
    ? reasons.record(repo, pr.number, blocked)
    : reasons.clear(repo, pr.number));
  await project.audit.write({
    event_type: "pr_blocked_reason",
    payload: reasonChange(pr.number, current, blocked),
  });
  await announceReason(project, pr, blocked);

  return `#${pr.number} ${blocked?.reason ?? "clear"}`;
}

async function handleMergeRefused(
  { repo, deps }: ClosedScope,
  params: ReasonEvent["params"],
): Promise<string> {
  const prNumber = Number(params.pr_number);
  const message = String(params.message ?? "");

  if (!GENERIC.test(message)) {
    await deps.reasons.resetUnclassifiedRefusals(repo, prNumber);

    return recordRefusal({ repo, deps }, prNumber, message);
  }
  const count = await deps.reasons.bumpUnclassifiedRefusal(repo, prNumber);

  return count >= 3
    ? recordRefusal({ repo, deps }, prNumber, message)
    : `#${prNumber} unclassified refusal ${count}/3`;
}

async function recordRefusal(
  { repo, deps }: Pick<ClosedScope, "repo" | "deps">,
  prNumber: number,
  detail: string,
): Promise<string> {
  const project = await deps.project(repo);
  const pr = (await project.pulls.get(prNumber)) ?? { number: prNumber };

  return applyReason({ repo, project, reasons: deps.reasons }, pr, {
    reason: "github_refused",
    detail,
  });
}

/** Messages that look like generic infrastructure errors rather than recognisable GitHub refusal conditions. */
const GENERIC = /unknown|server.?error|internal.?error|timeout/i;

async function resolveBlockedReason(
  project: BlockedReasonProject,
  pr: PullRef,
): Promise<BlockedReason | null> {
  if (await project.hasReviewInFlight?.(pr.number)) {
    return { reason: "review_in_flight", detail: null };
  }
  const [state, blockingDependencyPr] = await Promise.all([
    pullState(project.pulls, pr),
    resolveBlockingDependency(project, project.pulls as PullReader, pr),
  ]);

  return deriveBlockedReason({ ...state, blockingDependencyPr });
}

const codeOf = (blocked: BlockedReason | null) => blocked?.reason ?? null;

const reasonChange = (
  prNumber: number,
  from: BlockedReason | null,
  to: BlockedReason | null,
) => ({
  prNumber,
  from: codeOf(from),
  to: codeOf(to),
  detail: to?.detail ?? null,
});

async function pullState(pulls: ReasonPulls, pr: PullRef): Promise<PullState> {
  const base = pr.baseBranch ?? "main";
  const head = pr.headSha ?? pr.branch;
  const [mergeability, rule, checks, ci, reviews] = await Promise.all([
    pulls.getMergeability(pr.number),
    pulls.getBranchRule(base),
    pulls.listChecks(head),
    pulls.ciConclusion(head),
    pulls.listReviews(pr.number),
  ]);

  return {
    base,
    mergeability,
    rule,
    checks,
    ci,
    approvals: approvalCount(reviews),
  };
}

const sameReason = (
  current: BlockedReason | null,
  next: BlockedReason | null,
): boolean =>
  current?.reason === next?.reason && current?.detail === next?.detail;
