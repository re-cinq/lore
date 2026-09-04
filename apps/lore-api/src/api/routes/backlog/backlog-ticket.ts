// Ticket projection: task/run/node rows read for the backlog view, folded into the pure `Ticket` shape the route hands back.

import type { Pool } from "pg";
import type { IssueRef } from "@re-cinq/lore-shared";
import type { WireOf } from "@re-cinq/lore-shared/lib/wire-schema.js";
import { pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import { PRIORITY_LABELS } from "@re-cinq/lore-shared";
import type { Ticket } from "./backlog-schema.js";

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

export const LOOP_TASK_COLUMNS = pickColumns(
  PIPELINE_TASK_COLUMNS,
  LOOP_TASK_FIELDS,
);

export type LoopTaskRow = Pick<
  WireOf<typeof PipelineTaskSchema.shape, typeof PIPELINE_TASK_COLUMNS>,
  | "id"
  | "created_at"
  | "status"
  | "description"
  | "issue_number"
  | "issue_url"
  | "pr_url"
>;

export const priorityOf = (issue: IssueRef | undefined): string | null =>
  issue?.labels.find((l) =>
    (PRIORITY_LABELS as readonly string[]).includes(l),
  ) ?? null;

export interface LoopRunRow {
  id: string;
  task_id: string;
  status: string;
  reason: string | null;
  graph: { nodes?: Array<{ id: string; type: string }> } | null;
}

export interface NodeRow {
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

export function taskTicket(
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

interface RunContext {
  taskRuns: LoopRunRow[];
  nodeRows: NodeRow[];
}

// Each listed task's latest loop run + node rows, two batched queries; guarded because `= ANY($1)` on an empty JS array makes Postgres guess the type and 500 on a fresh repo.
export async function fetchRunContext(
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
