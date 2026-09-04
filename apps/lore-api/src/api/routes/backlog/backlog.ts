import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import type { IssueRef } from "@re-cinq/lore-shared";
import type { WireOf } from "@re-cinq/lore-shared/lib/wire-schema.js";
import { pickColumns, selectList } from "@re-cinq/lore-shared/lib/row.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import {
  orderBacklog,
  PRIORITY_LABELS,
  BACKLOG_LABEL_SEED,
} from "@re-cinq/lore-shared";
import { OPEN_TASK_STATES } from "@re-cinq/lore-shared/project/tasks/task-store-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  ImplementationLoopSchema,
  ToggleBodySchema,
  ToggleResultSchema,
  type Ticket,
} from "./backlog-schema.js";

// The backlog loop's repo surface (FR10): GET returns toggle/current/queue/recent, PUT flips the toggle. Deliberately not a dark-factory privileged field — the loop never merges, so no CODEOWNER ceremony (FR7).

const PATH = "/api/repos/{owner}/{repo}/implementation-loop";

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;

/** Display cap for the recently-addressed list. */
const RECENT_LIMIT = 10;

// The implementation-loop task fields the backlog view reads, picked from the pipeline.tasks wire contract.
const LOOP_TASK_FIELDS = [
  "id",
  "createdAt",
  "status",
  "description",
  "issueNumber",
  "issueUrl",
  "prUrl",
] as const;

const LOOP_TASK_COLUMNS = pickColumns(PIPELINE_TASK_COLUMNS, LOOP_TASK_FIELDS);

type LoopTaskRow = Pick<
  WireOf<typeof PipelineTaskSchema.shape, typeof PIPELINE_TASK_COLUMNS>,
  | "id"
  | "created_at"
  | "status"
  | "description"
  | "issue_number"
  | "issue_url"
  | "pr_url"
>;

const priorityOf = (issue: IssueRef | undefined): string | null =>
  issue?.labels.find((l) =>
    (PRIORITY_LABELS as readonly string[]).includes(l),
  ) ?? null;

interface LoopRunRow {
  id: string;
  task_id: string;
  status: string;
  reason: string | null;
  graph: { nodes?: Array<{ id: string; type: string }> } | null;
}

interface NodeRow {
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  outcome: string | null;
}

/** Latest station-run visit per node in `run`, later iterations winning over earlier ones. */
function latestVisitByNode(
  runId: string,
  nodeRows: readonly NodeRow[],
): Map<string, NodeRow> {
  const latest = new Map<string, NodeRow>();

  for (const row of nodeRows) {
    if (row.assembly_run_id !== runId) {
      continue;
    }
    const prior = latest.get(row.node_id);

    if (!prior || row.iteration >= prior.iteration) {
      latest.set(row.node_id, row);
    }
  }

  return latest;
}

/** absent = pending, open = running/waiting for a human station. */
function nodeState(
  node: { id: string; type: string },
  visit: NodeRow | undefined,
): { node_id: string; state: string } {
  if (!visit) {
    return { node_id: node.id, state: "pending" };
  }

  if (visit.outcome === null) {
    return {
      node_id: node.id,
      state: node.type === "pr_review" ? "waiting" : "running",
    };
  }

  return { node_id: node.id, state: visit.outcome };
}

// The mini graph: every graph node in definition order, colored by its latest station-run outcome.
export function pipelineOf(
  run: LoopRunRow | undefined,
  nodeRows: readonly NodeRow[],
): Array<{ node_id: string; state: string }> | null {
  if (!run?.graph?.nodes) {
    return null;
  }
  const latest = latestVisitByNode(run.id, nodeRows);

  return run.graph.nodes.map((node) => nodeState(node, latest.get(node.id)));
}

function runSummary(run: LoopRunRow | undefined): {
  error: string | null;
  run_id: string | null;
} {
  return { error: run?.reason ?? null, run_id: run?.id ?? null };
}

function ticketTitle(issue: IssueRef | undefined, row: LoopTaskRow): string {
  return issue?.title ?? row.description.split("\n")[0];
}

function taskTicket(
  row: LoopTaskRow,
  openIssues: readonly IssueRef[],
  run: LoopRunRow | undefined,
  nodeRows: readonly NodeRow[],
): Ticket | null {
  if (!row.issue_number) {
    return null;
  }
  const issue = openIssues.find((i) => i.number === row.issue_number);
  const { error, run_id } = runSummary(run);

  return {
    issue_number: row.issue_number,
    issue_url: row.issue_url,
    title: ticketTitle(issue, row),
    priority: priorityOf(issue),
    pr_url: row.pr_url,
    state: row.status,
    created_at: new Date(row.created_at).toISOString(),
    error,
    run_id,
    pipeline: pipelineOf(run, nodeRows),
  };
}

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

interface RunContext {
  taskRuns: LoopRunRow[];
  nodeRows: NodeRow[];
}

// Each listed task's latest loop run + node rows, two batched queries; guarded because `= ANY($1)` on an empty JS array makes Postgres guess the type and 500 on a fresh repo.
async function fetchRunContext(
  pool: Pool,
  taskIds: readonly string[],
): Promise<RunContext> {
  if (taskIds.length === 0) {
    return { taskRuns: [], nodeRows: [] };
  }
  const { rows: taskRuns } = await pool.query<LoopRunRow>(
    `SELECT DISTINCT ON (task_id) id, task_id, status, reason, graph
       FROM pipeline.assembly_runs
      WHERE task_id = ANY($1::uuid[])
        AND blueprint_name = 'implementation-loop'
      ORDER BY task_id, created_at DESC`,
    [taskIds],
  );

  if (taskRuns.length === 0) {
    return { taskRuns, nodeRows: [] };
  }
  const { rows: nodeRows } = await pool.query<NodeRow>(
    `SELECT assembly_run_id, node_id, iteration, outcome
       FROM pipeline.station_runs
      WHERE assembly_run_id = ANY($1::uuid[])
      ORDER BY started_at`,
    [taskRuns.map((r) => r.id)],
  );

  return { taskRuns, nodeRows };
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
      const { rows } = await pool.query<{
        settings: Record<string, unknown> | null;
      }>("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);

      enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);
      const enabled = resolveEnabled(rows[0].settings);
      // 2x the display cap: filtering out the open rows must still leave a full recent list.
      const { rows: taskRows } = await pool.query<LoopTaskRow>(
        `SELECT ${selectList(LOOP_TASK_COLUMNS)}
           FROM pipeline.tasks
          WHERE target_repo = $1 AND task_type = 'implementation-loop'
          ORDER BY created_at DESC
          LIMIT ${RECENT_LIMIT * 2}`,
        [repo],
      );
      const project = await projectFor(repo);
      const openIssues = await project.issues.list({ state: "open" });
      const { rows: runRows } = await pool.query<{ id: string }>(
        `SELECT id FROM pipeline.assembly_runs
          WHERE repo = $1 AND subject_key = 'backlog'
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC LIMIT 1`,
        [repo],
      );
      const taskIds = taskRows.map((t) => t.id);
      const { taskRuns, nodeRows } = await fetchRunContext(pool, taskIds);
      const runByTask = new Map(taskRuns.map((r) => [r.task_id, r]));
      const currentRow = taskRows.find((t) =>
        (OPEN_TASK_STATES as readonly string[]).includes(t.status),
      );
      const current = currentRow
        ? taskTicket(
            currentRow,
            openIssues,
            runByTask.get(currentRow.id),
            nodeRows,
          )
        : null;
      // Mirror the driver's eligibility guard: an issue whose task isn't failed/cancelled is already being worked or addressed — showing it as "next up" duplicated it into next and recent at once.
      const guardedIssues = new Set(
        taskRows
          .filter((t) => !["failed", "cancelled"].includes(t.status))
          .map((t) => t.issue_number),
      );
      const next = orderBacklog(openIssues)
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
      const recent = taskRows
        .filter((t) => t !== currentRow)
        .filter(
          (t) => !(OPEN_TASK_STATES as readonly string[]).includes(t.status),
        )
        .slice(0, RECENT_LIMIT)
        .map((t) => taskTicket(t, openIssues, runByTask.get(t.id), nodeRows))
        .filter((t): t is Ticket => t !== null);

      return h
        .response({
          enabled,
          current,
          current_run_id: runRows[0]?.id ?? null,
          next,
          recent,
        })
        .code(200);
    },
  };
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

      // Opting in seeds the loop's label taxonomy (FR1/FR7) for repos onboarded before the feature existed; create-or-ignore-existing, and a code-host hiccup must not fail the settings write that already committed.
      if (enabled) {
        try {
          const project = await projectFor(repo);

          await project.issues.createLabels(BACKLOG_LABEL_SEED);
        } catch (err) {
          console.warn(
            `[implementation-loop] label seeding for ${repo} failed: ${String(err)}`,
          );
        }
      }

      return h.response({ ok: true as const, enabled }).code(200);
    },
  };
}
