import { cappedBacklog, projectBacklog } from "./backlog-project.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { rankingCriteriaFor } from "@re-cinq/lore-shared";
import { selectList } from "@re-cinq/lore-shared/lib/row.js";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { openFloorLoopRun } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { zodResponse } from "../../http/zod-response.js";
import { ImplementationLoopSchema, type Onboarding } from "./backlog-schema.js";
import {
  LOOP_TASK_COLUMNS,
  type LoopRunRow,
  type LoopTaskRow,
  type NodeRow,
} from "./backlog-ticket.js";
import { fetchRunContext, fillFromFloor } from "./backlog-run-context.js";
import { withPool } from "../with-pool.js";
import { onboardingOf, readRepoRow } from "./backlog-repo.js";
import {
  recentWindow,
  SectionLimitsQuery,
  type SectionLimits,
} from "../loops/loop-sections.js";
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

const BACKLOG_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: { query: zodValidate(SectionLimitsQuery) },
  },
  ImplementationLoopSchema,
  {
    name: "ImplementationLoop",
    description:
      "The repo's backlog loop: toggle state, the ticket being worked, the ordered queue, and recently addressed tickets.",
  },
);

function readBacklogRoute(
  getPool: () => Pool | null,
  queuedIssues: QueuedIssues,
): ServerRoute {
  return {
    method: "GET",
    path: PATH,
    options: BACKLOG_OPTIONS,
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
  const limits = request.query as SectionLimits;
  const state = await loadBacklogState({
    reads,
    repo: repoOf(request.params),
    recentLimit: recentWindow(limits, RECENT_LIMIT),
  });

  return h
    .response({
      enabled: state.enabled,
      current_run_id: state.currentRunId,
      onboarding: state.onboarding,
      ...cappedBacklog(projectBacklog(state), limits),
    })
    .code(200);
}

export interface BacklogState extends BacklogIssues {
  /** How many settled tickets Recently addressed gathers. */
  recentLimit: number;
  enabled: boolean;
  onboarding: Onboarding;
  criteria?: import("@re-cinq/lore-shared/backlog/select-next-issue.js").RankingCriterion[];
  taskRows: LoopTaskRow[];
  currentRunId: string | null;
  runByTask: Map<string, LoopRunRow>;
  nodeRows: NodeRow[];
}

/** Everything the view needs, read in one place: the toggle and onboarding state, the loop's task rows, the repo's open issues, and the run each task belongs to. */
interface LoadBacklogStateArgs {
  reads: BacklogReads;
  repo: string;
  recentLimit: number;
}
async function loadBacklogState(
  args: LoadBacklogStateArgs,
): Promise<BacklogState> {
  const read = await readRepoRow(args.reads.pool, args.repo);
  const issues = await readIssues(
    args.repo,
    args.reads.queuedIssues,
    buildLoopTasksReader(args),
    rankingCriteriaFor(read.repo.settings),
  );
  const runIndex = await readRunIndex(
    args.reads.pool,
    args.repo,
    issues.taskRows,
  );
  const currentRunId = await readCurrentRunId(args.reads.pool, args.repo);

  return Object.assign(issues, runIndex, {
    recentLimit: args.recentLimit,
    enabled: resolveEnabled(read.repo.settings),
    onboarding: onboardingOf(read),
    criteria: rankingCriteriaFor(read.repo.settings),
    currentRunId,
  });
}

function buildLoopTasksReader(args: LoadBacklogStateArgs) {
  return (openIssueNumbers: readonly number[]) =>
    readLoopTasks(args.reads.pool, {
      repo: args.repo,
      recentLimit: args.recentLimit,
      openIssueNumbers,
    });
}

interface LoopTasksQuery {
  repo: string;
  recentLimit: number;
  openIssueNumbers: readonly number[];
}

/** The loop's own tasks, newest first: TWICE the recent cap, since the open ones are filtered out to build the "recent" list and without the headroom a repo with several in flight would show a short one, and beside them the newest task of every open issue, however old. A settled task holding its ticket through an open pull request fell out of the newest 20 on re-cinq/Otto, and the board listed its ticket as queued while the loop skipped it. */
async function readLoopTasks(
  pool: Pool,
  { repo, recentLimit, openIssueNumbers }: LoopTasksQuery,
): Promise<LoopTaskRow[]> {
  const { rows } = await pool.query<LoopTaskRow>(
    `WITH loop AS (
       SELECT ${selectList(LOOP_TASK_COLUMNS)}
         FROM pipeline.tasks
        WHERE target_repo = $1 AND task_type = 'implementation-loop'
     )
     (SELECT * FROM loop ORDER BY created_at DESC LIMIT $2)
     UNION
     (SELECT DISTINCT ON (issue_number) * FROM loop
       WHERE issue_number = ANY($3::int[])
       ORDER BY issue_number, created_at DESC)
     ORDER BY created_at DESC`,
    [repo, recentLimit * 2, openIssueNumbers],
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
