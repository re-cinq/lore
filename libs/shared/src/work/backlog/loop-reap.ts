// Nothing moves a `pipeline.tasks` row of task_type `implementation-loop` off `running` except a settled-run event arriving from the floor (ADR-049) — so a dispatch that crashes before the floor ever registers a run leaves the task stuck at `running` forever, with no trace and no retry. This sweep catches exactly that: tasks `running` for longer than a floor run could plausibly take to even start, with no matching run on the floor at all.
import { floorRepoOf } from "../../outbound/floor/floor-items.js";
import { startValueOf } from "../../outbound/floor/run-start-items.js";
import type { StuckRunningTask } from "../../outbound/project/tasks/task-store-port.js";
import {
  LOOP_LINE,
  FLOOR_BACKLOG_SUBJECT,
  type LoopRunsFloor,
} from "./floor-loop.js";
import { LORE_BLOCKED_LABEL } from "./labels.js";

/** Default when the env var is unset or not a positive integer — mirrors `loop-infra-deferral.ts`'s `DEFAULT_INFRA_DEFERRALS`. */
export const DEFAULT_REAP_RETRIES = 3;

export function reapRetriesFromEnv(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.LORE_LOOP_REAP_RETRIES);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REAP_RETRIES;
}

/** How long a task may sit at `running` before this sweep considers it stuck — comfortably past the floor's own 30-minute unclaimed-run timeout, so the two never race: that timeout only helps once a floor run record exists, and this sweep only ever catches the case where one never did. */
const STUCK_AFTER_MINUTES = 35;

/** Reaps count against the same 24h window `loop-infra-deferral.ts` uses for its own bounded retry. */
const COUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

const REASON_PREFIX = "no floor run was ever created for this task";

export type StuckTask = StuckRunningTask;

export interface LoopReapDeps {
  floor: LoopRunsFloor;
  tasks: {
    findStuckRunning(
      taskType: string,
      olderThanMinutes: number,
    ): Promise<StuckTask[]>;
    countRecentFailures(
      repo: string,
      issueNumber: number,
      reasonPrefix: string,
      since: Date,
    ): Promise<number>;
    setStatusIf(
      id: string,
      expectedStatus: string,
      status: string,
      extra?: Record<string, unknown>,
    ): Promise<boolean>;
    recordEvent(
      id: string,
      fromStatus: string | null,
      toStatus: string | null,
      meta?: Record<string, unknown>,
    ): Promise<void>;
  };
  comment(repo: string, issueNumber: number, body: string): Promise<void>;
  addLabel(repo: string, issueNumber: number, label: string): Promise<void>;
  maxRetries: number;
}

export async function reapStuckLoopTasks(
  deps: LoopReapDeps,
): Promise<string> {
  const stuck = await deps.tasks.findStuckRunning(
    LOOP_LINE,
    STUCK_AFTER_MINUTES,
  );
  const results = await Promise.all(
    stuck.map((task) => reapIfOrphaned(deps, task)),
  );
  const reaped = results.filter(Boolean).length;

  return `reaped ${reaped} of ${stuck.length} stuck task(s)`;
}

async function reapIfOrphaned(
  deps: LoopReapDeps,
  task: StuckTask,
): Promise<boolean> {
  if (await hasFloorRun(deps.floor, task)) {
    return false;
  }

  return reapOne(deps, task);
}

/** Any run at all — open or finished — carrying this task's id as its `task_id` start item means the floor DOES know about it: leave it alone (either it's genuinely still working, or its settlement is the delivery-reaper's job to redeliver, not this sweep's). */
async function hasFloorRun(
  floor: LoopRunsFloor,
  task: StuckTask,
): Promise<boolean> {
  const { items: floorRuns } = await floor.runs.list({
    repo: floorRepoOf(task.target_repo),
    line: LOOP_LINE,
    subject: FLOOR_BACKLOG_SUBJECT,
  });

  return floorRuns.some((run) => startValueOf(run, "task_id") === task.id);
}

async function reapOne(
  deps: LoopReapDeps,
  task: StuckTask,
): Promise<boolean> {
  const reason = `${REASON_PREFIX} within ${STUCK_AFTER_MINUTES} minutes of being claimed — the dispatch likely crashed before asking the floor to start it`;
  const won = await deps.tasks.setStatusIf(task.id, "running", "failed", {
    failure_reason: reason,
  });

  if (!won) {
    return false;
  }
  await deps.tasks.recordEvent(task.id, "running", "failed", {
    reaper: "loop-reap",
  });

  if (task.issue_number !== null) {
    await announce(deps, task.target_repo, task.issue_number, reason);
  }

  return true;
}

async function announce(
  deps: LoopReapDeps,
  repo: string,
  issueNumber: number,
  reason: string,
): Promise<void> {
  const attempt = await attemptNumber(deps, repo, issueNumber);

  if (attempt >= deps.maxRetries) {
    await deps.addLabel(repo, issueNumber, LORE_BLOCKED_LABEL);
  }
  await deps.comment(
    repo,
    issueNumber,
    reapComment(reason, attempt, deps.maxRetries),
  );
}

async function attemptNumber(
  deps: LoopReapDeps,
  repo: string,
  issueNumber: number,
): Promise<number> {
  const since = new Date(Date.now() - COUNT_WINDOW_MS);

  return (
    (await deps.tasks.countRecentFailures(
      repo,
      issueNumber,
      REASON_PREFIX,
      since,
    )) + 1
  );
}

function reapComment(reason: string, attempt: number, max: number): string {
  const found = `Lore's implementation loop found this ticket's task stuck: ${reason}.`;

  return attempt >= max
    ? `${found} This has now happened ${attempt} of ${max} times within a day, so the loop stops retrying it automatically — fix what's keeping dispatch from reaching the floor, then remove the ${LORE_BLOCKED_LABEL} label to re-queue it.`
    : `${found} Nothing about the ticket failed; it is being requeued automatically (attempt ${attempt} of ${max}).`;
}
