/** The slice of the repo's files a branch check needs, narrow so a test needs no Project. */
export interface BranchRepo {
  branchExists(branch: string): Promise<boolean> | undefined;
  createBranch(branch: string, base?: string): Promise<void>;
  defaultBranch(): Promise<string>;
}

/** Cuts the branch from the default branch only when it is confirmed missing: creating it again would reset the commits it already holds. */
export async function ensureBranch(
  repo: BranchRepo,
  branch: string,
): Promise<void> {
  const exists = await repo.branchExists(branch);

  if (exists === false) {
    await repo.createBranch(branch, await repo.defaultBranch());
  }
}
