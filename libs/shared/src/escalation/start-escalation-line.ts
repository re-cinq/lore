/**
 * Start the escalation line for a task that needs a human.
 *
 * Keyed by the TASK, because more than one thing can notice the same failure —
 * the agent watcher, a failed line's terminal step, and (if it is ever wired in)
 * the stale sweep. Two of them racing must produce one Issue, not two at the
 * same person.
 *
 * Capped for the reason the merge line is capped, learned the hard way in
 * production: a task that stays in its failed state is noticed again on every
 * sweep, and an uncapped start would open a fresh line — and eventually a fresh
 * Issue — every time. Past the cap the failure is already recorded on three
 * runs and telling the human a fourth time helps nobody.
 */

export interface EscalationTask {
  id: string;
  repo: string;
  branch: string;
}

export interface EscalationCause {
  reason: string;
  diagnostic: string;
}

export interface StartEscalationDeps {
  findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<{ id: string } | null>;
  countBySubject(repo: string, subjectKey: string): Promise<number>;
  start(input: {
    blueprintName: string;
    taskId: string;
    repo: string;
    branch: string;
    subjectKey: string;
    args: Record<string, unknown>;
  }): Promise<string>;
}

/** How many times one task may escalate before it stops being told again. */
export const MAX_ESCALATION_ATTEMPTS = 3;

/** One line per task, whoever notices the failure first. */
export const escalationSubject = (taskId: string): string =>
  `escalate:${taskId}`;

export async function startEscalationLine(
  task: EscalationTask,
  cause: EscalationCause,
  deps: StartEscalationDeps,
): Promise<string | null> {
  const subjectKey = escalationSubject(task.id);

  if (await deps.findOpenBySubject(task.repo, subjectKey)) {
    return null;
  }

  if (
    (await deps.countBySubject(task.repo, subjectKey)) >=
    MAX_ESCALATION_ATTEMPTS
  ) {
    return null;
  }

  return deps.start({
    blueprintName: "escalation",
    taskId: task.id,
    repo: task.repo,
    // The line touches no working tree; the branch is carried so the Issue can
    // link it, and doubles as the overlap-guard key.
    branch: subjectKey,
    subjectKey,
    args: {
      branch_name: task.branch,
      reason: cause.reason,
      diagnostic: cause.diagnostic,
    },
  });
}
