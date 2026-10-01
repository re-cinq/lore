/** Every minute, picks up the ready tasks of a plan and starts an implementation-loop run on the external floor for each, admitted by `admitSpecTasks`: at most 3 per task_group_id, and never two of a group together that edit one file or where either is not parallelizable. */
import {
  planTaskBacklog,
  startLoopRun,
  type LoopFloor,
} from "../backlog/floor-loop.js";
import type {
  ReadySpecTask,
  RunningSpecTask,
} from "../../outbound/project/tasks/task-queue-port.js";
import { admitSpecTasks } from "./spec-task-admission.js";
import {
  specTaskBrief,
  taskIssueOf,
  type LiveIssue,
  type SpecTaskBrief,
} from "./spec-task-brief.js";

export interface SpecTaskExecutorDeps {
  readyTasks(): Promise<ReadySpecTask[]>;
  runningTasks(): Promise<RunningSpecTask[]>;
  creditsExhausted(): Promise<boolean>;
  /** Takes the pending task; false when another dispatcher won it. */
  claim(taskId: string): Promise<boolean>;
  /** Returns a claimed task that nothing runs for to `pending`, so the next tick tries it again. */
  release(taskId: string): Promise<void>;
  /** The task issue as it reads now; null when it is gone. */
  liveIssue(repo: string, issueNumber: number): Promise<LiveIssue | null>;
  /** The run's pods check the branch out, so it has to exist before the run does (plan 3b3a67af's T001–T003, 2026-09-29). */
  ensureBranch(repo: string, branch: string): Promise<void>;
  floor: LoopFloor;
}

export async function runSpecTaskExecutor(
  deps: SpecTaskExecutorDeps,
): Promise<string> {
  const ready = await deps.readyTasks();

  if (ready.length === 0) {
    return "No ready spec-tasks";
  }

  if (await deps.creditsExhausted()) {
    console.warn(
      "[spec-task-executor] API credits exhausted, skipping dispatch",
    );

    return "Skipped: API credits exhausted";
  }
  const started = await startReadyTasks(ready, deps);

  return started > 0
    ? `Started ${started}/${ready.length} ready spec-tasks`
    : "No ready spec-tasks";
}

/** Admission is decided for the whole sweep at once, so it holds within one tick as well as across ticks. */
async function startReadyTasks(
  ready: ReadySpecTask[],
  deps: SpecTaskExecutorDeps,
): Promise<number> {
  const admitted = admitSpecTasks(ready, await deps.runningTasks());
  let started = 0;

  for (const task of admitted) {
    if (await startClaimed(task, deps)) {
      started++;
    }
  }

  return started;
}

/** A start that fails after the claim RELEASES it: the row is claimed but nothing is running, and only a release lets the next tick try again. */
async function startClaimed(
  task: ReadySpecTask,
  deps: SpecTaskExecutorDeps,
): Promise<boolean> {
  if (!(await deps.claim(task.id))) {
    return false;
  }

  try {
    const brief = await startSpecTask(task, deps);

    console.log(
      `[spec-task-executor] started ${brief.specTaskId} (${task.id}) on the floor`,
    );

    return true;
  } catch (err) {
    await deps.release(task.id);
    console.error(
      `[spec-task-executor] could not start ${task.id}: ${(err as Error).message}`,
    );

    return false;
  }
}

/** One task, one implementation-loop run: the task issue is its ticket, and the run is keyed on the task so the tasks of a plan run side by side. */
export async function startSpecTask(
  task: ReadySpecTask,
  deps: Pick<SpecTaskExecutorDeps, "liveIssue" | "ensureBranch" | "floor">,
): Promise<SpecTaskBrief> {
  const brief = specTaskBrief(task, await liveIssueOf(task, deps));

  await deps.ensureBranch(task.target_repo, brief.branchName);
  await startLoopRun(deps.floor, {
    repo: task.target_repo,
    taskId: task.id,
    branch: brief.branchName,
    issue: { title: brief.issueTitle, number: brief.issueNumber },
    description: brief.description,
    backlog: planTaskBacklog(task.id),
  });

  return brief;
}

// A task with no issue, or a GitHub read that fails, briefs from what was filed instead of holding the start.
async function liveIssueOf(
  task: ReadySpecTask,
  deps: Pick<SpecTaskExecutorDeps, "liveIssue">,
): Promise<LiveIssue | undefined> {
  const number = taskIssueOf(task);

  if (number === undefined) {
    return undefined;
  }

  try {
    return (await deps.liveIssue(task.target_repo, number)) ?? undefined;
  } catch (err) {
    console.warn(
      `[spec-task-executor] task issue #${number} unreadable, briefing from the filed detail: ${(err as Error).message}`,
    );

    return undefined;
  }
}
