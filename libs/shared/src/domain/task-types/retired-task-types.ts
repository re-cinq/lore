import { enforceTrue, type ErrorType } from "../../lib/enforce.js";

/** Task types that ran one agent pass over a free-text description. The implementation loop replaced both (#2328, #2329): work is a ticket in the repository's backlog, not a typed task. */
export const RETIRED_TASK_TYPES: readonly string[] = [
  "implementation",
  "general",
];

const USE_THE_LOOP =
  "To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.";

export function isRetiredTaskType(taskType: string): boolean {
  return RETIRED_TASK_TYPES.includes(taskType);
}

/** The type a new task is created with. There is no default: the type that used to stand in for a missing one is gone. */
export function namedTaskType(
  taskType: string | undefined,
  errorType: ErrorType = Error,
): string {
  enforceTrue(
    taskType,
    errorType,
    `task_type is required: a task with no type has nothing to run it. ${USE_THE_LOOP}`,
  );
  enforceTrue(
    !isRetiredTaskType(taskType),
    errorType,
    `The "${taskType}" task type was removed. ${USE_THE_LOOP}`,
  );

  return taskType;
}
