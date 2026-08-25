// The Agent CR's recipe pins `ref: <task branch>` and the subsystem's init runs a
// bare `git checkout <ref>`, which exits 1 when the branch does not exist. The
// branch name embeds the task id, so for a fresh task it never does — every
// Agent-CR task type died in its init container with
// `pathspec '...' did not match any file(s) known to git`.
//
// The in-process handlers (onboard / feature-request)
// already create their branch before writing to it; this is the same step for the
// Agent-CR path. It must NOT be an unconditional createBranch: that call
// force-resets an existing branch (delete + recreate at base), which would throw
// away the commits of a revision task resuming its own branch.

/** The slice of `project.repo` this needs — narrow so tests need no Project. */
export interface TaskBranchRepo {
  branchExists(branch: string): Promise<boolean> | undefined;
  createBranch(branch: string, base?: string): Promise<void>;
  defaultBranch(): Promise<string>;
}

/**
 * Make sure the task's branch exists before an Agent CR is told to check it out.
 * Creates it off the default branch ONLY when the remote is known to lack it —
 * an existing branch is left alone, and an adapter that cannot answer (or a probe
 * that fails) leaves it alone too, because guessing here destroys work. A creation
 * failure propagates: a task that fails now with a legible reason beats a pod that
 * dies in its init container.
 */
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
