/**
 * Start the merge line for a task whose PR has merged.
 *
 * The sweep used to DO the post-merge work inline; it now only notices the merge
 * and starts the line that does it. That is what turns nine consecutive
 * statements — five of them behind swallowing catches — into nine recorded
 * visits whose failures route forward instead of skipping what follows.
 *
 * Keyed by the TASK, so the per-minute sweep and a webhook noticing the same
 * merge converge on one run rather than racing to start two.
 */

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

/**
 * How many merge lines one task may burn before the sweep stops re-starting it.
 *
 * `settle` is the line's only hard stop, and it fails BEFORE the task is marked
 * merged — so the task stays in `mergeableTasks()` and the per-minute sweep
 * would start a fresh ten-node line every minute, forever, with no backoff.
 * A few retries absorb a transient database blip; past that the failure is
 * recorded on three runs and re-running it only burns the factory.
 */
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
