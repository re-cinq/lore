/** Start the merge line for a task whose PR has merged. */

export interface MergeLineTask {
  id: string;
  target_repo: string;
  pr_number: number;
}

export interface StartMergeLineDeps {
  countBySubject(repo: string, subjectKey: string): Promise<number>;
  findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<{ id: string } | null>;
  start(input: {
    blueprintName: string;
    taskId: string;
    repo: string;
    branch: string;
    subjectKey: string;
    args: Record<string, unknown>;
  }): Promise<string>;
}

/** Max retries before abandoning a failed merge line. */
export const MAX_MERGE_LINE_ATTEMPTS = 3;

/** One line per task, whoever notices the merge first. */
export const mergeSubject = (taskId: string): string => `merge:${taskId}`;

export async function startMergeLine(
  task: MergeLineTask,
  deps: StartMergeLineDeps,
): Promise<string | null> {
  const subjectKey = mergeSubject(task.id);

  if (await deps.findOpenBySubject(task.target_repo, subjectKey)) {
    return null;
  }

  if (
    (await deps.countBySubject(task.target_repo, subjectKey)) >=
    MAX_MERGE_LINE_ATTEMPTS
  ) {
    return null;
  }

  return deps.start({
    blueprintName: "merge",
    taskId: task.id,
    repo: task.target_repo,
    // The line touches no working tree; the branch is only the overlap-guard key.
    branch: subjectKey,
    subjectKey,
    args: { pr_number: task.pr_number },
  });
}
