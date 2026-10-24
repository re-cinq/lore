import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { heldBacklog, orderBacklog } from "@re-cinq/lore-shared";
import { selectList } from "@re-cinq/lore-shared/lib/row.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { openFloorLoopRun } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import {
  ImplementationLoopSchema,
  type Onboarding,
  type Ticket,
} from "./backlog-schema.js";
import {
  guardsIssue,
  isAwaitingMerge,
  isCurrentTask,
  LOOP_TASK_COLUMNS,
  taskTicket,
  waitingTicket,
  type LoopRunRow,
  type LoopTaskRow,
  type NodeRow,
} from "./backlog-ticket.js";
import { fetchRunContext, fillFromFloor } from "./backlog-run-context.js";
import { withPool } from "../with-pool.js";
import { onboardingOf, readRepoRow } from "./backlog-repo.js";
import {
  queuedIssuesReader,
  readIssues,
  type BacklogIssues,
  type QueuedIssues,
} from "./backlog-issues.js";

export { pipelineOf } from "./backlog-ticket.js";

// The backlog loop's repo surface (FR10): GET returns the switch state, current, queue and recent tickets. The switch itself is flipped at PUT /api/repos/{owner}/{repo}/loops/implementation (routes/loops).

const PATH = "/api/repos/{owner}/{repo}/implementation-loop";

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;

/** Display cap for the recently-addressed list. */
const RECENT_LIMIT = 10;

export function implementationLoopRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [readBacklogRoute(getPool, queuedIssuesReader())];
}

function readBacklogRoute(
  getPool: () => Pool | null,
  queuedIssues: QueuedIssues,
): ServerRoute {
  return {
    method: "GET",
    path: PATH,
    options: zodResponse(bearerScope("read"), ImplementationLoopSchema, {
      name: "ImplementationLoop",
      description:
        "The repo's backlog loop: toggle state, the ticket being worked, the ordered queue, and recently addressed tickets.",
    }),
    handler: withPool(getPool, (pool, request, h) =>
      serveReadBacklog({ pool, queuedIssues }, request, h),
    ),
  };
}

/** What a backlog read is served from: the database, and the route's cache of queued issues. */
interface BacklogReads {
  pool: Pool;
  queuedIssues: QueuedIssues;
}

async function serveReadBacklog(
  reads: BacklogReads,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const state = await loadBacklogState(reads, repoOf(request.params));

  return h
    .response({
      enabled: state.enabled,
      current_run_id: state.currentRunId,
      onboarding: state.onboarding,
      ...projectBacklog(state),
    })
    .code(200);
}

interface BacklogState extends BacklogIssues {
  enabled: boolean;
  onboarding: Onboarding;
  taskRows: LoopTaskRow[];
  currentRunId: string | null;
  runByTask: Map<string, LoopRunRow>;
  nodeRows: NodeRow[];
}

/** Everything the view needs, read in one place: the toggle and onboarding state, the loop's task rows, the repo's open issues, and the run each task belongs to. */
async function loadBacklogState(
  { pool, queuedIssues }: BacklogReads,
  repo: string,
): Promise<BacklogState> {
  const read = await readRepoRow(pool, repo);
  const taskRows = await readLoopTasks(pool, repo);

  return {
    enabled: resolveEnabled(read.repo.settings),
    onboarding: onboardingOf(read),
    taskRows,
    ...(await readIssues(repo, taskRows, queuedIssues)),
    currentRunId: await readCurrentRunId(pool, repo),
    ...(await readRunIndex(pool, repo, taskRows)),
  };
}

/** The loop's own tasks, newest first. TWICE the display cap is read: the open ones are filtered out to build the "recent" list, and without the headroom a repo with several in flight would show a short one. */
async function readLoopTasks(pool: Pool, repo: string): Promise<LoopTaskRow[]> {
  const { rows } = await pool.query<LoopTaskRow>(
    `SELECT ${selectList(LOOP_TASK_COLUMNS)}
           FROM pipeline.tasks
          WHERE target_repo = $1 AND task_type = 'implementation-loop'
          ORDER BY created_at DESC
          LIMIT ${RECENT_LIMIT * 2}`,
    [repo],
  );

  return rows;
}

function resolveEnabled(settings: Record<string, unknown> | null): boolean {
  const loop = (
    settings as { implementation_loop?: { enabled?: unknown } } | null
  )?.implementation_loop;

  return loop?.enabled === true;
}

/** The run driving this repo's backlog, if one is open. Keyed on the `backlog` subject rather than on a task, because the driver run outlives any single ticket it works. Postgres only ever held this for Lore's own retired engine (ADR-049), so an open run today is answered by the floor. */
async function readCurrentRunId(
  pool: Pool,
  repo: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pipeline.assembly_runs
          WHERE repo = $1 AND subject_key = 'backlog'
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC LIMIT 1`,
    [repo],
  );

  if (rows[0]) {
    return rows[0].id;
  }

  if (!floorConfigured()) {
    return null;
  }

  const open = await openFloorLoopRun(floorClient(), repo);

  return open?.id ?? null;
}

// Last, and in this order: the node read is scoped to the task ids above, and the run lookup shares its cursor. A task the Postgres read found nothing for is tried on the floor instead (FR17/ADR-049): every implementation-loop run has lived there since the external-floor cutover.
async function readRunIndex(
  pool: Pool,
  repo: string,
  taskRows: LoopTaskRow[],
): Promise<Pick<BacklogState, "runByTask" | "nodeRows">> {
  const { taskRuns, nodeRows } = await fetchRunContext(
    pool,
    taskRows.map((t) => t.id),
  );
  const runByTask = new Map(taskRuns.map((r) => [r.task_id, r] as const));
  const missing = taskRows.filter((t) => !runByTask.has(t.id));
  const extraNodeRows = floorConfigured()
    ? await fillFromFloor(floorRunReader(), repo, missing, runByTask)
    : [];

  return { runByTask, nodeRows: [...nodeRows, ...extraNodeRows] };
}

interface BacklogBuckets {
  current: Ticket[];
  next: Ticket[];
  parked: Ticket[];
  recent: Ticket[];
  awaiting_merge: Ticket[];
}

function projectBacklog(state: BacklogState): BacklogBuckets {
  const currentRows = currentTaskRows(state);
  const currentIds = new Set(currentRows.map((t) => t.id));
  const parkedIssues = heldBacklog(state.openIssues);
  const parkedIssueNumbers = new Set(parkedIssues.map((issue) => issue.number));

  return {
    current: currentRows
      .map((t) => taskTicket(t, state))
      .filter((t): t is Ticket => t !== null),
    next: nextTickets(state),
    parked: parkedIssues.map((issue) => waitingTicket(issue, "parked", state)),
    recent: recentTickets(state, currentIds, parkedIssueNumbers),
    awaiting_merge: awaitingMergeTickets(state, currentIds),
  };
}

/** Every task being worked right now — the loop's own pick, and any ticket a human revived by hand. More than one can be true at once. */
function currentTaskRows(state: BacklogState): LoopTaskRow[] {
  return state.taskRows.filter((t) => isCurrentTask(t, state.runByTask));
}

/** A settled ticket whose loop branch still has an open pull request. Its own bucket, uncapped, so a ticket a human has not merged yet stays visible no matter how much other work settles behind it — `recentTickets` would otherwise push it off after `RECENT_LIMIT` newer tasks settle. */
function awaitingMergeTickets(
  state: BacklogState,
  currentIds: ReadonlySet<string>,
): Ticket[] {
  return settledTaskRows(state, currentIds)
    .filter((t) => isAwaitingMerge(t, state.openPrBranches))
    .map((t) => taskTicket(t, state))
    .filter((t): t is Ticket => t !== null);
}

/** What is queued behind the current work. An issue a task still holds is EXCLUDED, and without it an issue already being worked appeared as "next up" and in "recent" at the same time. */
function nextTickets(state: BacklogState): Ticket[] {
  const { taskRows, openIssues, runByTask, openPrBranches } = state;
  const guardedIssues = new Set(
    taskRows
      .filter((t) => guardsIssue(t, runByTask, openPrBranches))
      .map((t) => t.issue_number),
  );

  return orderBacklog(openIssues)
    .filter((i) => !guardedIssues.has(i.number))
    .map((issue) => waitingTicket(issue, "queued", state));
}

/** Settled work, newest first and capped. Any currently-worked task (the loop's pick, or a by-hand revival) is excluded by id rather than by status, so it does not appear twice. A ticket still awaiting a merge lives in its own uncapped bucket instead (`awaitingMergeTickets`), so it is excluded here to avoid showing twice. A ticket still parked (its issue carries `lore:blocked`) is excluded too — Parked wins, so a failed task whose issue got blocked doesn't show in both buckets at once. */
function recentTickets(
  state: BacklogState,
  currentIds: ReadonlySet<string>,
  parkedIssueNumbers: ReadonlySet<number>,
): Ticket[] {
  return settledTaskRows(state, currentIds)
    .filter((t) => !isAwaitingMerge(t, state.openPrBranches))
    .filter((t) => !parkedIssueNumbers.has(t.issue_number ?? -1))
    .slice(0, RECENT_LIMIT)
    .map((t) => taskTicket(t, state))
    .filter((t): t is Ticket => t !== null);
}

/** Every task not currently being worked — `currentIds` already covers every open-status task and every by-hand revival, so excluding by id alone is enough. Shared ordering for `recentTickets` and `awaitingMergeTickets`. */
function settledTaskRows(
  state: BacklogState,
  currentIds: ReadonlySet<string>,
): LoopTaskRow[] {
  return state.taskRows.filter((t) => !currentIds.has(t.id));
}
