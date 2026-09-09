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

export function taskTicket(
  row: LoopTaskRow,
  openIssues: readonly IssueRef[],
  run: LoopRunRow | undefined,
  nodeRows: readonly NodeRow[],
): Ticket | null {
  const { issue_number } = row;

  if (!issue_number) {
    return null;
  }
  const issue = openIssues.find((i) => i.number === issue_number);

  return {
    ...ticketIssueFields(row, issue_number, issue),
    ...ticketTaskFields(row),
    ...runSummary(run),
    pipeline: pipelineOf(run, nodeRows),
  };
}

function ticketIssueFields(
  row: LoopTaskRow,
  issueNumber: number,
  issue: IssueRef | undefined,
) {
  return {
    issue_number: issueNumber,
    issue_url: row.issue_url,
    title: ticketTitle(issue, row),
    priority: priorityOf(issue),
  };
}

function ticketTitle(issue: IssueRef | undefined, row: LoopTaskRow): string {
  return issue?.title ?? row.description.split("\n")[0]; // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
}

function ticketTaskFields(row: LoopTaskRow) {
  return {
    pr_url: row.pr_url,
    state: row.status,
    created_at: new Date(row.created_at).toISOString(),
  };
}

function runSummary(run: LoopRunRow | undefined): {
  error: string | null;
  run_id: string | null;
} {
  return { error: run?.reason ?? null, run_id: run?.id ?? null };
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
  const { nodes } = run.graph;

  return nodes.map((node) => nodeState(node, latest.get(node.id)));
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

/** Node types whose open row means "parked", not "working": a person, or a build, owns the next move. Mirrors HUMAN_STATION_TYPES, which lore-api does not depend on. */
const WAITING_NODE_TYPES = new Set(["pr_review", "ci_check"]);

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
      state: WAITING_NODE_TYPES.has(node.type) ? "waiting" : "running",
    };
  }

  return { node_id: node.id, state: visit.outcome };
}

interface RunContext {
  taskRuns: LoopRunRow[];
  nodeRows: NodeRow[];
}

const LOOP_RUNS_SQL = `SELECT DISTINCT ON (task_id) id, task_id, status, reason, graph
       FROM pipeline.assembly_runs
      WHERE task_id = ANY($1::uuid[])
        AND blueprint_name = 'implementation-loop'
      ORDER BY task_id, created_at DESC`;

const RUN_NODES_SQL = `SELECT assembly_run_id, node_id, iteration, outcome
       FROM pipeline.station_runs
      WHERE assembly_run_id = ANY($1::uuid[])
      ORDER BY started_at`;

// Each listed task's latest loop run + node rows, two batched queries; guarded because `= ANY($1)` on an empty JS array makes Postgres guess the type and 500 on a fresh repo.
export async function fetchRunContext(
  pool: Pool,
  taskIds: readonly string[],
): Promise<RunContext> {
  if (taskIds.length === 0) {
    return { taskRuns: [], nodeRows: [] };
  }
  const { rows: taskRuns } = await pool.query<LoopRunRow>(LOOP_RUNS_SQL, [
    taskIds,
  ]);

  if (taskRuns.length === 0) {
    return { taskRuns, nodeRows: [] };
  }
  const { rows: nodeRows } = await pool.query<NodeRow>(RUN_NODES_SQL, [
    taskRuns.map((r) => r.id),
  ]);

  return { taskRuns, nodeRows };
}
