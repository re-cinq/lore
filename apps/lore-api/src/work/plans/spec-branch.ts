import { ensureBranch, type BranchRepo } from "../repo/ensure-branch.js";

export type SpecBranchRepo = BranchRepo;

/** One branch per plan: what `spec-write` pushes and the spec PR opens from, so a restart or an amendment lands where the first pass did. */
export function specBranchOf(plan: { id: string }): string {
  return `lore/feature-planning/${plan.id}`;
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
