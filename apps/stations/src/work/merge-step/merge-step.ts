import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { MergeableTask } from "@re-cinq/lore-shared/project/tasks/task-queue-port.js";
/** One step of the merge line: failures route forward via assembly-line graph. */

export type MergeStepTask = Pick<
  MergeableTask,
  | "id"
  | "target_repo"
  | "pr_number"
  | "issue_number"
  | "task_type"
  | "description"
>;

export interface MergeStepDeps {
  task(taskId: string): Promise<MergeStepTask | null>;
  setStatus(taskId: string, status: string): Promise<void>;
  recordEvent(taskId: string, from: string, to: string): Promise<void>;
  flipSpecStatus(task: MergeStepTask): Promise<void>;
  commentAndCloseIssue(task: MergeStepTask): Promise<void>;
  recordOutcome(task: MergeStepTask): Promise<void>;
  curate(task: MergeStepTask): Promise<void>;
  applyOutcomeFeedback(taskId: string, kind: "boost"): Promise<void>;
  promoteTrust(repo: string): Promise<void>;
  syncSpecTasks(task: MergeStepTask): Promise<void>;
  resumePlanning(repo: string, prNumber: number): Promise<void>;
}

/** The steps, in the order the blueprint walks them. */
export const MERGE_STEPS = [
  "settle",
  "spec-status",
  "close-issue",
  "outcome-stats",
  "curate",
  "memory-feedback",
  "trust",
  "spec-tasks",
  "resume-planning",
] as const;

export type MergeStep = (typeof MERGE_STEPS)[number];

const isStep = (v: string): v is MergeStep =>
  (MERGE_STEPS as readonly string[]).includes(v);

/** Only a merged feature-request produces the tasks.md this step reads. */
const PRODUCES_SPEC_TASKS = "feature-request";

const STEPS: Record<
  MergeStep,
  (task: MergeStepTask, deps: MergeStepDeps) => Promise<void>
> = {
  settle: async (task, deps) => {
    await deps.setStatus(task.id, "merged");
    await deps.recordEvent(task.id, "pr-created", "merged");
  },
  "spec-status": (task, deps) => deps.flipSpecStatus(task),
  "close-issue": async (task, deps) => {
    if (task.issue_number === null) {
      return;
    }
    await deps.commentAndCloseIssue(task);
  },
  "outcome-stats": (task, deps) => deps.recordOutcome(task),
  curate: (task, deps) => deps.curate(task),
  "memory-feedback": (task, deps) =>
    deps.applyOutcomeFeedback(task.id, "boost"),
  trust: (task, deps) => deps.promoteTrust(task.target_repo),
  "spec-tasks": async (task, deps) => {
    if (task.task_type !== PRODUCES_SPEC_TASKS) {
      return;
    }
    await deps.syncSpecTasks(task);
  },
  "resume-planning": (task, deps) =>
    deps.resumePlanning(task.target_repo, task.pr_number),
};

export async function runMergeStep(
  step: string,
  taskId: string,
  deps: MergeStepDeps,
): Promise<void> {
  enforceTrue(
    isStep(step),
    Error,
    `merge line has no step "${step}" — the blueprint and the station disagree`,
  );
  const task = await deps.task(taskId);

  enforceTrue(
    task,
    Error,
    `merge step "${step}": task ${taskId} no longer exists`,
  );

  await STEPS[step](task, deps);
}
