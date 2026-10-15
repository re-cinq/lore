// The blocked-reason station: on every GitHub event that can change why a Lore PR is not merging, it derives the reason again and, only when it changed, records it, audits it and edits the one comment on the PR and on its backlog issue (specs/protected-branch-merge).

import { loreTaskIdOf } from "@re-cinq/lore-shared";
import type { BlockedReason } from "@re-cinq/lore-shared/blocked-reason.js";
import type { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import type { AppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import type { PrBlockedReasonsPort } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-port.js";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { syncReasonComment, type CommentThread } from "./comment.js";
import {
  approvalCount,
  deriveBlockedReason,
  type PullState,
} from "./derivation.js";

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
>;

export interface BlockedReasonProject {
  pulls: ReasonPulls;
  /** The PR's conversation and its backlog issue's: both are issue comments on GitHub. */
  issues: CommentThread;
  audit: Pick<Audit, "write">;
  /** The backlog issue of a task; null when the task is unknown or has none. */
  taskIssue(taskId: string): Promise<number | null>;
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
  const repo = String(event.params.repo ?? "");

  if (event.name === "github.pull_request.closed") {
    return closePulls(deps.reasons, repo, pullNumbersIn(event.params));
  }
  const project = await deps.project(repo);
  const pulls = await lorePulls(event, project.pulls, login);
  const scope = { repo, project, reasons: deps.reasons };
  const outcomes = await Promise.all(pulls.map((pr) => refresh(scope, pr)));

  return outcomes.join("; ") || "no Lore PR to read";
}

/** A closed PR's row is stamped closed; one Lore never recorded has no row, so nothing needs the PR's author. */
async function closePulls(
  reasons: PrBlockedReasonsPort,
  repo: string,
  numbers: number[],
): Promise<string> {
  await Promise.all(numbers.map((number) => reasons.close(repo, number)));

  return numbers.map((number) => `#${number} closed`).join("; ");
}

function pullNumbersIn(params: ReasonEvent["params"]): number[] {
  const listed = Array.isArray(params.pr_numbers) ? params.pr_numbers : [];

  return [params.pr_number, ...listed].filter(
    (n): n is number => typeof n === "number",
  );
}

/** The open, non-draft PRs this event concerns that Lore's App opened: a push concerns every open PR based on the pushed branch. */
async function lorePulls(
  event: ReasonEvent,
  pulls: ReasonPulls,
  login: string,
): Promise<PullRef[]> {
  const concerned =
    event.name === "github.push"
      ? (await pulls.list()).filter(
          (pr) => pr.baseBranch === event.params.branch,
        )
      : await Promise.all(pullNumbersIn(event.params).map((n) => pulls.get(n)));

  return concerned
    .filter((pr): pr is PullRef => pr !== null)
    .filter((pr) => pr.author === login && awaitsMerge(pr));
}

/** A draft is still being written, not waiting to merge: the loop pushes to it many times, and a reason on it would only be noise. */
const awaitsMerge = (pr: PullRef): boolean =>
  pr.state === "open" && pr.draft !== true;

async function refresh(scope: RepoScope, pr: PullRef): Promise<string> {
  const { project, reasons } = scope;
  const blocked = deriveBlockedReason(await pullState(project.pulls, pr));
  const current = await reasons.current(scope.repo, pr.number);

  if (sameReason(current, blocked)) {
    return `#${pr.number} unchanged`;
  }
  await persist(scope, pr.number, blocked);
  await project.audit.write({
    event_type: "pr_blocked_reason",
    payload: reasonChange(pr.number, current, blocked),
  });
  await announce(project, pr, blocked);

  return `#${pr.number} ${blocked?.reason ?? "clear"}`;
}

/** The audit row's payload: `from` and `to` are reason codes, null where nothing blocks. */
function reasonChange(
  prNumber: number,
  from: BlockedReason | null,
  to: BlockedReason | null,
): Record<string, unknown> {
  return {
    prNumber,
    from: codeOf(from),
    to: codeOf(to),
    detail: to?.detail ?? null,
  };
}

const codeOf = (blocked: BlockedReason | null) => blocked?.reason ?? null;

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

function persist(
  { repo, reasons }: RepoScope,
  prNumber: number,
  blocked: BlockedReason | null,
): Promise<void> {
  return blocked
    ? reasons.record(repo, prNumber, blocked)
    : reasons.clear(repo, prNumber);
}

/** The PR's comment first, then the backlog issue's, when the PR names a task that has one. */
async function announce(
  project: BlockedReasonProject,
  pr: PullRef,
  blocked: BlockedReason | null,
): Promise<void> {
  await syncReasonComment(project.issues, pr.number, blocked);
  const taskId = loreTaskIdOf(pr.body);
  const issue = taskId ? await project.taskIssue(taskId) : null;

  if (issue) {
    await syncReasonComment(project.issues, issue, blocked);
  }
}
