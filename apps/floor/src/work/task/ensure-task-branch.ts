// Must create the branch only when missing, never unconditionally: an unconditional createBranch force-resets an existing branch, destroying a resuming revision task's commits.

/** The slice of `project.repo` this needs — narrow so tests need no Project. */
export interface TaskBranchRepo {
  branchExists(branch: string): Promise<boolean> | undefined;
  createBranch(branch: string, base?: string): Promise<void>;
  defaultBranch(): Promise<string>;
}

/** Creates the task's branch off default only when confirmed missing; an adapter that can't answer is left alone rather than guessed at. */
export async function ensureTaskBranch(
  repo: TaskBranchRepo,
  branch: string,
): Promise<void> {
  let exists: boolean | undefined;

  try {
    exists = await repo.branchExists(branch);
  } catch {
    return;
  }

  if (exists !== false) {
    return;
  }

  await repo.createBranch(branch, await repo.defaultBranch());
}
