import { enforceTrue, type ErrorType } from "../../lib/enforce.js";

const USE_THE_LOOP =
  "To have something implemented, open an issue with a priority:high, priority:medium or priority:low label and the implementation loop picks it up.";

const START_A_PLAN =
  "To have a feature specified, start a plan on the repository's Plans page.";

const REVIEWED_ALREADY =
  "Every open pull request is reviewed already; comment `@lore review` on one to have it reviewed again.";

/** Task types that are refused, each with where its work goes now. The implementation loop took what was implemented or written from a description (#2328, #2329), plans took feature requests (ADR-047), the code-review line reviews every pull request, and a plan's own tasks joined the backlog as tickets when the spec-task executor was removed (`specs/external-floor` FR15.0). */
const WHERE_IT_WENT: Readonly<Record<string, string>> = {
  implementation: USE_THE_LOOP,
  general: USE_THE_LOOP,
  runbook: USE_THE_LOOP,
  "gap-fill": USE_THE_LOOP,
  "feature-request": START_A_PLAN,
  "feature-finalize": START_A_PLAN,
  review: REVIEWED_ALREADY,
  "spec-task": USE_THE_LOOP,
};

export const RETIRED_TASK_TYPES: readonly string[] = Object.keys(WHERE_IT_WENT);

/** What a caller asking for a typed task is told: none is created from a description any more. */
export const NO_TYPED_TASKS = `Lore no longer runs typed tasks, so nothing is created here. ${USE_THE_LOOP.replace("implemented", "implemented or written")} ${START_A_PLAN} ${REVIEWED_ALREADY}`;

export function isRetiredTaskType(taskType: string): boolean {
  return RETIRED_TASK_TYPES.includes(taskType);
}

/** The type a task row is written with. There is no default, and a removed type is refused with where its work goes now: the rows that remain belong to the lines that keep one (onboarding, plans, the loop). */
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
    `The "${taskType}" task type was removed. ${WHERE_IT_WENT[taskType]}`,
  );

  return taskType;
}
