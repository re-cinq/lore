import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { orderBacklog, BACKLOG_LABEL_SEED } from "@re-cinq/lore-shared";
import { selectList } from "@re-cinq/lore-shared/lib/row.js";
import { OPEN_TASK_STATES } from "@re-cinq/lore-shared/project/tasks/task-store-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  ImplementationLoopSchema,
  ToggleBodySchema,
  ToggleResultSchema,
  type Ticket,
} from "./backlog-schema.js";
import {
  fetchRunContext,
  LOOP_TASK_COLUMNS,
  priorityOf,
  taskTicket,
  type LoopTaskRow,
} from "./backlog-ticket.js";

export { pipelineOf } from "./backlog-ticket.js";

// The backlog loop's repo surface (FR10): GET returns toggle/current/queue/recent, PUT flips the toggle. Deliberately not a dark-factory privileged field — the loop never merges, so no CODEOWNER ceremony (FR7).

const PATH = "/api/repos/{owner}/{repo}/implementation-loop";

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;

/** Display cap for the recently-addressed list. */
const RECENT_LIMIT = 10;

export function implementationLoopRoutes(
  getPool: () => Pool | null,
): ServerRoute[] {
  return [readBacklogRoute(getPool), writeBacklogRoute(getPool)];
}

function resolveEnabled(settings: Record<string, unknown> | null): boolean {
  const loop = (
    settings as { implementation_loop?: { enabled?: unknown } } | null
  )?.implementation_loop;

  return loop?.enabled === true;
}

type OpenIssues = Parameters<typeof taskTicket>[1];
type NodeRows = Parameters<typeof taskTicket>[3];

interface BacklogState {
  enabled: boolean;
  taskRows: LoopTaskRow[];
  openIssues: OpenIssues;
  currentRunId: string | null;
  runByTask: Map<string, Parameters<typeof taskTicket>[2] & object>;
  nodeRows: NodeRows;
}

/** Everything the view needs, read in one place: the toggle, the loop's task rows, the repo's open issues, and the run each task belongs to. */
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

/** The run driving this repo's backlog, if one is open. Keyed on the `backlog` subject rather than on a task, because the driver run outlives any single ticket it works. */
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

  return rows[0]?.id ?? null;
}

async function loadBacklogState(
  pool: Pool,
  repo: string,
): Promise<BacklogState> {
  const { rows } = await pool.query<{
    settings: Record<string, unknown> | null;
  }>("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);

  enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);

  const taskRows = await readLoopTasks(pool, repo);
  const openIssues = await (
    await projectFor(repo)
  ).issues.list({
    state: "open",
  });
  const currentRunId = await readCurrentRunId(pool, repo);
  // Last, and in this order: the node read is scoped to the task ids above, and the run lookup shares its cursor.
  const { taskRuns, nodeRows } = await fetchRunContext(
    pool,
    taskRows.map((t) => t.id),
  );

  return {
    enabled: resolveEnabled(rows[0].settings),
    taskRows,
    openIssues,
    currentRunId,
    runByTask: new Map(taskRuns.map((r) => [r.task_id, r])),
    nodeRows,
  };
}

/** What is queued behind the current work. Issues whose task is neither failed nor cancelled are EXCLUDED — this mirrors the driver's own eligibility guard, and without it an issue already being worked appeared as "next up" and in "recent" at the same time. */
function nextTickets(
  openIssues: BacklogState["openIssues"],
  taskRows: BacklogState["taskRows"],
): unknown[] {
  const guardedIssues = new Set(
    taskRows
      .filter((t) => !["failed", "cancelled"].includes(t.status))
      .map((t) => t.issue_number),
  );

  return orderBacklog(openIssues)
    .filter((i) => !guardedIssues.has(i.number))
    .map((i) => ({
      issue_number: i.number,
      issue_url: i.url ?? null,
      title: i.title,
      priority: priorityOf(i),
      pr_url: null,
      state: "queued",
      created_at: i.createdAt ? new Date(i.createdAt).toISOString() : null,
      error: null,
      run_id: null,
      pipeline: null,
    }));
}

/** Settled work, newest first and capped. The current ticket is excluded by identity rather than by status, so a task that settled between the two reads does not appear twice. */
function recentTickets(state: BacklogState, currentRow: unknown): Ticket[] {
  const { taskRows, openIssues, runByTask, nodeRows } = state;

  return taskRows
    .filter((t) => t !== currentRow)
    .filter((t) => !(OPEN_TASK_STATES as readonly string[]).includes(t.status))
    .slice(0, RECENT_LIMIT)
    .map((t) => taskTicket(t, openIssues, runByTask.get(t.id), nodeRows))
    .filter((t): t is Ticket => t !== null);
}

function projectBacklog(state: BacklogState): {
  current: Ticket | null;
  next: unknown[];
  recent: Ticket[];
} {
  const { taskRows, openIssues, runByTask, nodeRows } = state;
  const currentRow = taskRows.find((t) =>
    (OPEN_TASK_STATES as readonly string[]).includes(t.status),
  );

  return {
    current: currentRow
      ? taskTicket(
          currentRow,
          openIssues,
          runByTask.get(currentRow.id),
          nodeRows,
        )
      : null,
    next: nextTickets(openIssues, taskRows),
    recent: recentTickets(state, currentRow),
  };
}

function readBacklogRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: PATH,
    options: zodResponse(bearerScope("read"), ImplementationLoopSchema, {
      name: "ImplementationLoop",
      description:
        "The repo's backlog loop: toggle state, the ticket being worked, the ordered queue, and recently addressed tickets.",
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const repo = repoOf(request.params);
      const state = await loadBacklogState(pool, repo);

      return h
        .response({
          enabled: state.enabled,
          current_run_id: state.currentRunId,
          ...projectBacklog(state),
        })
        .code(200);
    },
  };
}

/** Flips the loop's `enabled` flag. The UPDATE merges rather than replaces at BOTH levels — the repo's other settings and the loop's own other keys must survive a toggle. */
async function setLoopEnabled(
  pool: Pool,
  repo: string,
  enabled: boolean,
): Promise<void> {
  const { rows } = await pool.query<{ full_name: string }>(
    "SELECT full_name FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);
  await pool.query(
    `UPDATE lore.repos
            SET settings = COALESCE(settings, '{}'::jsonb)
              || jsonb_build_object('implementation_loop',
                   COALESCE(settings->'implementation_loop', '{}'::jsonb)
                     || jsonb_build_object('enabled', $2::boolean))
          WHERE full_name = $1`,
    [repo, enabled],
  );
}

/** Seeds the loop's label taxonomy (FR1/FR7) for repos onboarded before the feature existed. Create-or-ignore, and swallowed: the settings write has already committed, so a code-host hiccup must not report the toggle as failed. */
async function seedBacklogLabels(repo: string): Promise<void> {
  try {
    await (await projectFor(repo)).issues.createLabels(BACKLOG_LABEL_SEED);
  } catch (err) {
    console.warn(
      `[implementation-loop] label seeding for ${repo} failed: ${String(err)}`,
    );
  }
}

function writeBacklogRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: PATH,
    options: zodResponse(
      {
        ...bearerScope("admin"),
        validate: { payload: zodValidate(ToggleBodySchema) },
      },
      ToggleResultSchema,
      {
        name: "ImplementationLoopToggle",
        description: "Enable or disable the repo's backlog loop.",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const repo = repoOf(request.params);
      const { enabled } = request.payload as { enabled: boolean };

      await setLoopEnabled(pool, repo, enabled);

      if (enabled) {
        await seedBacklogLabels(repo);
      }

      return h.response({ ok: true as const, enabled }).code(200);
    },
  };
}
