// The auto-merge loop's last step (specs/protected-branch-merge): a green, reviewed pull request old enough to merge is approved and handed to GitHub, or merged by Lore where no rule asks for an approval.
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import type {
  BranchRule,
  MergeMethod,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** What approves: lore-reviewer when it is installed, otherwise Lore's own App. */
export interface Approver {
  /** Absent for lore-reviewer, which never opens a pull request. */
  login?: string;
  approve(prNumber: number, body: string): Promise<void>;
}

export interface MergeProject {
  pulls: {
    get(
      number: number,
    ): Promise<Pick<
      PullRef,
      "state" | "author" | "nodeId" | "baseBranch" | "autoMerge"
    > | null>;
    getBranchRule(
      branch: string,
    ): Promise<Pick<BranchRule, "requiredApprovals">>;
    enableAutoMerge(nodeId: string, method: MergeMethod): Promise<void>;
    merge(number: number, method: MergeMethod): Promise<void>;
  };
  /** The changed files a CODEOWNERS row gives an owner. */
  sensitivePaths(prNumber: number): Promise<string[]>;
  /** The repository's auto-merge switch, read again at the last step: it may have been switched off while the run waited. */
  loopOn(): Promise<boolean>;
  audit: { write(entry: Omit<AuditLogEntry, "repo">): Promise<void> };
}

export type MergeStep =
  | { outcome: "success"; state: "armed" | "merged" }
  | { outcome: "failed"; reason: string };

export const APPROVAL_BODY =
  "Approved by Lore's auto-merge loop: CI is green, Lore's review passed and every review thread is resolved.";

const SQUASH: MergeMethod = "squash";

/** Arms GitHub's auto-merge before approving where the base branch's rule asks for an approval (GitHub refuses to arm a pull request that can already merge), and merges directly where it asks for none, unless the pull request touches a path a code owner must approve. */
export async function approveAndMerge(
  project: MergeProject,
  approver: Approver | null,
  prNumber: number,
): Promise<MergeStep> {
  const pull = await project.pulls.get(prNumber);

  if (!pull || pull.state !== "open") {
    return settledStep(pull?.state);
  }

  if (!(await project.loopOn())) {
    return { outcome: "failed", reason: LOOP_OFF };
  }
  const usable = approverFor(approver, pull.author);

  return (await approvalRequired(project, pull.baseBranch))
    ? approveProtected(project, usable, { prNumber, pull })
    : mergeUnprotected(project, usable, prNumber);
}

export const LOOP_OFF =
  "the auto-merge loop was switched off before the pull request was approved";

/** A branch rule that asks for an approval needs one GitHub counts; Lore's own App cannot give it on a pull request it opened. */
async function approveProtected(
  project: MergeProject,
  approver: Approver | null,
  target: { prNumber: number; pull: Pick<PullRef, "nodeId" | "autoMerge"> },
): Promise<MergeStep> {
  return approver
    ? armAndApprove(project, approver, target)
    : { outcome: "failed", reason: NEEDS_REVIEWER };
}

function settledStep(state: string | undefined): MergeStep {
  return state === "merged"
    ? { outcome: "success", state: "merged" }
    : { outcome: "failed", reason: "the pull request is closed" };
}

export const NEEDS_REVIEWER =
  "needs the lore-reviewer App: GitHub refuses an approval from the App that opened this pull request";

export const NEEDS_CODE_OWNER =
  "needs a code owner: it changes a path CODEOWNERS assigns, and no rule on this branch asks for their approval before Lore merges";

/** lore-reviewer approves anything; Lore's own App cannot approve a pull request it opened. */
function approverFor(
  approver: Approver | null,
  author: string | undefined,
): Approver | null {
  if (!approver) {
    return null;
  }

  return approver.login !== undefined && approver.login === author
    ? null
    : approver;
}

async function approvalRequired(
  project: MergeProject,
  baseBranch: string | undefined,
): Promise<boolean> {
  if (!baseBranch) {
    return false;
  }
  const rule = await project.pulls.getBranchRule(baseBranch);

  return rule.requiredApprovals > 0;
}

async function armAndApprove(
  project: MergeProject,
  approver: Approver,
  {
    prNumber,
    pull,
  }: { prNumber: number; pull: Pick<PullRef, "nodeId" | "autoMerge"> },
): Promise<MergeStep> {
  if (!pull.autoMerge && pull.nodeId) {
    await project.pulls.enableAutoMerge(pull.nodeId, SQUASH);
    await project.audit.write(auditRow("auto_merge_armed", prNumber));
  }
  await approver.approve(prNumber, APPROVAL_BODY);
  await project.audit.write(auditRow(approvalEvent(approver), prNumber));

  return { outcome: "success", state: "armed" };
}

/** No rule asks for an approval, so none is needed to merge: Lore approves where it can, for the record, and merges. */
async function mergeUnprotected(
  project: MergeProject,
  approver: Approver | null,
  prNumber: number,
): Promise<MergeStep> {
  if ((await project.sensitivePaths(prNumber)).length > 0) {
    return { outcome: "failed", reason: NEEDS_CODE_OWNER };
  }
  await approver?.approve(prNumber, APPROVAL_BODY);
  await project.pulls.merge(prNumber, SQUASH);
  await project.audit.write(auditRow("auto_merge_merged", prNumber));

  return { outcome: "success", state: "merged" };
}

/** lore-reviewer's approval is the row the merged-without-a-click KPI counts (`pipeline.v_auto_merge_kpis`); Lore's own App approves only a person's pull request. */
function approvalEvent(approver: Approver): AuditEvent {
  return approver.login === undefined
    ? "lore_reviewer_approved"
    : "auto_merge_approved";
}

type AuditEvent =
  | "auto_merge_armed"
  | "auto_merge_approved"
  | "lore_reviewer_approved"
  | "auto_merge_merged";

function auditRow(
  eventType: AuditEvent,
  prNumber: number,
): Omit<AuditLogEntry, "repo"> {
  return { event_type: eventType, payload: { prNumber } };
}
