import {
  ensureBranch,
  type BranchRepo,
} from "../../outbound/project/repo/ensure-branch.js";

export type SpecBranchRepo = BranchRepo;

const SPEC_BRANCH_PREFIX = "lore/feature-planning/";
const SPEC_BRANCH = /^lore\/feature-planning\/([^/]+)$/;

/** One branch per plan: what `spec-write` pushes and the spec PR opens from, so a restart or an amendment lands where the first pass did. */
export function specBranchOf(plan: { id: string }): string {
  return `${SPEC_BRANCH_PREFIX}${plan.id}`;
}

/** The plan a spec branch belongs to; undefined for a branch a person cut. */
export function planIdOfSpecBranch(branch: string): string | undefined {
  return SPEC_BRANCH.exec(branch)?.[1];
}

/** The plan's spec branch, made when missing. */
export async function ensureSpecBranch(
  repo: SpecBranchRepo,
  plan: { id: string },
): Promise<string> {
  const branch = specBranchOf(plan);

  await ensureBranch(repo, branch);

  return branch;
}
