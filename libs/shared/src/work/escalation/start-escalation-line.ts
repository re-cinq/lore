/** Start the escalation line for a task needing a human: keyed by task id so racing noticers (agent watcher, terminal step, sweep) file one Issue not two, and capped at `MAX_ESCALATION_ATTEMPTS` so a stuck-failed task isn't reported forever. */

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

/** True when a line is already open for this task, or it has already been reported its full allowance of times. */
async function alreadyEscalated(
  task: EscalationTask,
  subjectKey: string,
  deps: StartEscalationDeps,
): Promise<boolean> {
  if (await deps.findOpenBySubject(task.repo, subjectKey)) {
    return true;
  }
  const attempts = await deps.countBySubject(task.repo, subjectKey);

  return attempts >= MAX_ESCALATION_ATTEMPTS;
}

function escalationArgs(
  task: EscalationTask,
  cause: EscalationCause,
): Record<string, unknown> {
  return {
    branch_name: task.branch,
    reason: cause.reason,
    diagnostic: cause.diagnostic,
  };
}

export async function startEscalationLine(
  task: EscalationTask,
  cause: EscalationCause,
  deps: StartEscalationDeps,
): Promise<string | null> {
  const subjectKey = escalationSubject(task.id);

  if (await alreadyEscalated(task, subjectKey, deps)) {
    return null;
  }

  return deps.start({
    blueprintName: "escalation",
    taskId: task.id,
    repo: task.repo,
    // No working tree involved; branch doubles as the Issue link + overlap-guard key.
    branch: subjectKey,
    subjectKey,
    args: escalationArgs(task, cause),
  });
}
