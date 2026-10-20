// What blocks a PR from merging, derived from what GitHub says about it: one reason, the first that holds in the spec's order, or null when nothing does.

import type { BlockedReason } from "@re-cinq/lore-shared/blocked-reason.js";
import type {
  BranchRule,
  CheckRun,
  CiConclusion,
  Mergeability,
  PullReview,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

export interface PullState {
  /** The branch the PR merges into. */
  base: string;
  mergeability: Mergeability;
  /** The base branch's rule. */
  rule: BranchRule;
  /** The check runs on the PR's head commit. */
  checks: CheckRun[];
  ci: CiConclusion;
  /** Reviewers whose latest verdict is an approval. */
  approvals: number;
}

type ReasonRule = (state: PullState) => BlockedReason | null;

const blocked = (
  reason: BlockedReason["reason"],
  detail: string | null = null,
): BlockedReason => ({ reason, detail });

const mergeConflict: ReasonRule = ({ base, mergeability }) =>
  mergeability.mergeable === false || mergeability.state === "dirty"
    ? blocked("merge_conflict", base)
    : null;

const baseBehind: ReasonRule = ({ base, mergeability }) =>
  mergeability.state === "behind" ? blocked("base_behind", base) : null;

const requiredCheckMissing: ReasonRule = ({ rule, checks }) => {
  const ran = new Set(checks.map((check) => check.name));
  const missing = rule.requiredChecks.find((name) => !ran.has(name));

  return missing ? blocked("required_check_missing", missing) : null;
};

/** A failed required check waits on CI too: on a fix and a green re-run, so the check that failed is named. */
const waitingOnCi: ReasonRule = ({ rule, checks, ci }) => {
  const required = checks.filter((check) =>
    rule.requiredChecks.includes(check.name),
  );
  const red = required.find(failed);

  if (red) {
    return blocked("waiting_on_ci", red.name);
  }
  const running = required.some((check) => check.status !== "completed");

  return running || ci === "pending" ? blocked("waiting_on_ci") : null;
};

/** GitHub cannot say whose approval counts as a code owner's, so a code-owner rule explains a PR GitHub still reports `blocked` once the other reasons are ruled out. */
const needsCodeOwner: ReasonRule = ({ rule, approvals, mergeability }) => {
  const unapproved = approvals < Math.max(rule.requiredApprovals, 1);
  const stillBlocked = unapproved || mergeability.state === "blocked";

  return rule.codeOwnersReview && stillBlocked
    ? blocked("needs_code_owner")
    : null;
};

const needsApproval: ReasonRule = ({ rule, approvals }) =>
  approvals < rule.requiredApprovals ? blocked("needs_approval") : null;

const PRECEDENCE: ReasonRule[] = [
  mergeConflict,
  baseBehind,
  requiredCheckMissing,
  waitingOnCi,
  needsCodeOwner,
  needsApproval,
];

export function deriveBlockedReason(state: PullState): BlockedReason | null {
  for (const rule of PRECEDENCE) {
    const found = rule(state);

    if (found) {
      return found;
    }
  }

  return null;
}

const VERDICTS = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

/** Reviewers whose latest verdict is APPROVED; a plain comment changes no verdict, as on GitHub. */
export function approvers(reviews: PullReview[]): string[] {
  const latest = new Map<string, string>();

  for (const review of reviews.filter((r) => VERDICTS.has(r.state))) {
    latest.set(review.user, review.state);
  }

  return [...latest]
    .filter(([, state]) => state === "APPROVED")
    .map(([user]) => user);
}

export const approvalCount = (reviews: PullReview[]): number =>
  approvers(reviews).length;

const PASSING = new Set(["success", "neutral", "skipped"]);

function failed(check: CheckRun): boolean {
  return check.status === "completed" && !PASSING.has(check.conclusion ?? "");
}
