// A merged pull request is the loop's own definition of success, whoever merged it: a ticket the run left blocked or still open on the floor must not stay that way once a human has already closed out the work by merging its branch.
import { floorRepoOf } from "../../outbound/floor/floor-items.js";
import { startValueOf } from "../../outbound/floor/run-start-items.js";
import { LOOP_LINE, FLOOR_BACKLOG_SUBJECT } from "./floor-loop.js";
import { LORE_BLOCKED_LABEL } from "./labels.js";
import type { TaskTransitionDeps } from "./task-transition-deps.js";
import type { RunView, RunPage } from "@re-cinq/floor-client";

const LOOP_BRANCH_ISSUE = /^lore\/implementation-loop\/issue-(\d+)$/;

/** The backlog issue a loop ticket's branch is named after, or null for any other branch. */
export function issueNumberFromLoopBranch(branch: string): number | null {
  const match = LOOP_BRANCH_ISSUE.exec(branch);

  return match ? Number(match[1]) : null;
}

export interface LoopTask {
  id: string;
  status: string;
}

export interface MergeSuccessFloor {
  runs: {
    list(filter: {
      repo: string;
      line: string;
      subject: string;
      open: boolean;
    }): Promise<RunPage>;
    cancel(runId: string, reason: string): Promise<RunView>;
  };
}

export interface MergeSuccessDeps {
  floor(): MergeSuccessFloor;
  tasks: TaskTransitionDeps & {
    /** The newest loop task for the issue, any status — a `failed` (loop-reap'd) or `completed` (parked at `await-pr`) task is exactly the kind a human merging the branch by hand should be able to settle. */
    latestLoopTaskByIssue(
      repo: string,
      issueNumber: number,
    ): Promise<LoopTask | null>;
  };
  comment(repo: string, issueNumber: number, body: string): Promise<void>;
  removeLabel(repo: string, issueNumber: number, label: string): Promise<void>;
  closeIssue(repo: string, issueNumber: number): Promise<void>;
  emitTick(repo: string): Promise<void>;
}

/** Settles a loop ticket's task as merged once its branch's pull request merges, regardless of what the floor run itself reported, or whether it ever closed. */
export async function settleMergedLoopTicket(
  deps: MergeSuccessDeps,
  repo: string,
  branch: string,
): Promise<string> {
  const issueNumber = issueNumberFromLoopBranch(branch);

  if (issueNumber === null) {
    return "not a loop branch";
  }
  const task = await deps.tasks.latestLoopTaskByIssue(repo, issueNumber);

  if (!task) {
    return "no task for this issue";
  }

  if (task.status === "merged") {
    return "task already settled";
  }
  await cancelOpenRun(deps.floor(), repo, task.id);

  return markMerged(deps, repo, issueNumber, task);
}

async function markMerged(
  deps: MergeSuccessDeps,
  repo: string,
  issueNumber: number,
  task: LoopTask,
): Promise<string> {
  const won = await deps.tasks.setStatusIf(task.id, task.status, "merged");

  if (!won) {
    return "lost the status race";
  }

  await deps.tasks.recordEvent(task.id, task.status, "merged", {
    settled_by: "pr-merged",
  });
  await settleIssue(deps, repo, issueNumber);
  await deps.emitTick(repo);

  return `settled task ${task.id} as merged`;
}

async function cancelOpenRun(
  floor: MergeSuccessFloor,
  repo: string,
  taskId: string,
): Promise<void> {
  const { items: open } = await floor.runs.list({
    repo: floorRepoOf(repo),
    line: LOOP_LINE,
    subject: FLOOR_BACKLOG_SUBJECT,
    open: true,
  });
  const run = open.find(
    (candidate) => startValueOf(candidate, "task_id") === taskId,
  );

  if (run) {
    await floor.runs.cancel(run.id, "pr-merged");
  }
}

async function settleIssue(
  deps: MergeSuccessDeps,
  repo: string,
  issueNumber: number,
): Promise<void> {
  await deps.removeLabel(repo, issueNumber, LORE_BLOCKED_LABEL);
  await deps.comment(
    repo,
    issueNumber,
    "Lore's implementation loop sees this ticket's pull request merged and is marking it done, whatever the run itself reported.",
  );
  await deps.closeIssue(repo, issueNumber);
}
