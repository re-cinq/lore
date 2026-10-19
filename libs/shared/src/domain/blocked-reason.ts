/** Why a Lore PR is not merging yet: the reason codes and the labels Lore shows for them (specs/protected-branch-merge, "Reason codes and labels"). */

export type BlockedReasonCode =
  | "waiting_on_ci"
  | "required_check_missing"
  | "needs_approval"
  | "needs_code_owner"
  | "base_behind"
  | "blocked_by_pr"
  | "review_in_flight"
  | "merge_conflict"
  | "github_refused";

/** One PR's current blocked reason; `detail` fills the label's blank (a check name, a base branch, a PR number, GitHub's message). */
export interface BlockedReason {
  reason: BlockedReasonCode;
  detail: string | null;
}

type Label = string | ((detail: string | null) => string);

const LABELS: Record<BlockedReasonCode, Label> = {
  waiting_on_ci: "Waiting for CI",
  required_check_missing: (d) =>
    `A required check has not run: ${d || "unknown"}`,
  needs_approval: "Needs one approval",
  needs_code_owner: "Needs a code owner's approval",
  base_behind: (d) => `Behind ${d || "base"}; needs the base merged in`,
  blocked_by_pr: (d) => `Waiting for #${d || "unknown"} to merge first`,
  review_in_flight: "Lore's review is still running",
  merge_conflict: (d) => `Conflicts with ${d || "base"}`,
  github_refused: (d) => `GitHub refused the merge: ${d || "unknown"}`,
};

const isReasonCode = (reason: string): reason is BlockedReasonCode =>
  Object.hasOwn(LABELS, reason);

/** The label for a stored reason; null when nothing blocks, and the code itself for one this vocabulary does not know. */
export function labelForReason(
  reason: string | null,
  detail: string | null,
): string | null {
  if (!reason) {
    return null;
  }

  if (!isReasonCode(reason)) {
    return reason;
  }
  const label = LABELS[reason];

  return typeof label === "function" ? label(detail) : label;
}
