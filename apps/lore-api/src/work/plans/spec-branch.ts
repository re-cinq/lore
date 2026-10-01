/** The slice of the repo's files this needs, narrow so a test needs no Project. */
export interface SpecBranchRepo {
  branchExists(branch: string): Promise<boolean> | undefined;
  createBranch(branch: string, base?: string): Promise<void>;
  defaultBranch(): Promise<string>;
}

/** One branch per plan: what `spec-write` pushes and the spec PR opens from, so a restart or an amendment lands where the first pass did. */
export function specBranchOf(plan: { id: string }): string {
  return `lore/feature-planning/${plan.id}`;
}

/** The plan's spec branch, cut from the default branch only when confirmed missing: creating it again would reset the commits a running spec PR holds. */
export async function ensureSpecBranch(
  repo: SpecBranchRepo,
  plan: { id: string },
): Promise<string> {
  const branch = specBranchOf(plan);
  const exists = await repo.branchExists(branch);

  if (exists === false) {
    await repo.createBranch(branch, await repo.defaultBranch());
  }

  return branch;
}
