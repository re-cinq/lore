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
import { ticketHold } from "@re-cinq/lore-shared/backlog/ticket-hold.js";
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import {
  miniPipeline,
  type PipelineNode,
} from "../../../work/assembly-line-station/mini-pipeline.js";
import type { FloorRunReads } from "../../../work/floor/floor-backed-runs.js";
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
  "failureReason",
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
  | "failure_reason"
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
  const lastAttempt = attemptOf(row, run);

  return {
    ...ticketIssueFields(row, issue_number, issue),
    ...ticketTaskFields(row),
    hold: ticketHold({ issue, openBlockers: [], lastAttempt, picked: true }),
    run_id: run?.id ?? null,
    pipeline: pipelineOf(run, nodeRows),
  };
}

/** How a task's attempt ended: the run's own reason where Postgres holds the run, otherwise what the settling hook stored on the task. */
function attemptOf(row: LoopTaskRow, run: LoopRunRow | undefined) {
  return { status: row.status, why: run?.reason ?? row.failure_reason };
}

/** What the queue and the parked list know about a ticket no task is working: its open blockers and its newest attempt, if it had one. */
export interface WaitingContext {
  openBlockers: ReadonlyMap<number, number[]>;
  taskRows: readonly LoopTaskRow[];
  runByTask: ReadonlyMap<string, LoopRunRow>;
}

/** A ticket read from its issue: `queued` when the picker will take it, `parked` when it will not. The pull request and run of its newest attempt ride along, since that is where its reader goes next. */
export function waitingTicket(
  issue: IssueRef,
  state: "queued" | "parked",
  context: WaitingContext,
): Ticket {
  const last = context.taskRows.find((t) => t.issue_number === issue.number);
  const run = last && context.runByTask.get(last.id);

  return {
    ...waitingIssueFields(issue),
    ...lastAttemptLinks(last, run),
    state,
    hold: ticketHold({
      issue,
      openBlockers: context.openBlockers.get(issue.number) ?? [],
      lastAttempt: last && attemptOf(last, run),
    }),
    pipeline: null,
  };
}

function lastAttemptLinks(
  last: LoopTaskRow | undefined,
  run: LoopRunRow | undefined,
) {
  return { pr_url: last?.pr_url ?? null, run_id: run?.id ?? null };
}

function waitingIssueFields(issue: IssueRef) {
  return {
    issue_number: issue.number,
    issue_url: issue.url ?? null,
    title: issue.title,
    priority: priorityOf(issue),
    created_at: issue.createdAt
      ? new Date(issue.createdAt).toISOString()
      : null,
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

// The mini graph: every graph node in definition order, colored by its latest station-run outcome.
export function pipelineOf(
  run: LoopRunRow | undefined,
  nodeRows: readonly NodeRow[],
): PipelineNode[] | null {
  if (!run?.graph?.nodes) {
    return null;
  }
  const visits = nodeRows
    .filter((row) => row.assembly_run_id === run.id)
    .map(({ node_id, iteration, outcome }) => ({
      nodeId: node_id,
      iteration,
      outcome,
    }));

  return miniPipeline(run.graph.nodes, visits);
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

/** A task's run and node visits read straight from the floor, for a task Postgres has no row for: every implementation-loop run has lived there since ADR-049, and `pipeline.assembly_runs` only holds the ones Lore's own retired engine walked. Callers try Postgres first (above) and call this only on a miss, so a floor-out-of-reach error costs one task its pipeline, not the whole page. */
export async function floorRunContext(
  floor: FloorRunReads,
  repo: string,
  taskId: string,
): Promise<{ run: LoopRunRow; nodeRows: NodeRow[] } | null> {
  const summary = (
    await floor.listSummaries({ repo, taskId, blueprintName: LOOP_LINE })
  ).at(0);

  if (!summary) {
    return null;
  }
  const run = await floorLoopRun(floor, summary, taskId);

  return run.graph?.nodes
    ? { run, nodeRows: await floorNodeRows(floor, run.id) }
    : { run, nodeRows: [] };
}

async function floorLoopRun(
  floor: FloorRunReads,
  summary: { id: string; status: string; reason: string | null },
  taskId: string,
): Promise<LoopRunRow> {
  const record = await floor.getById(summary.id);

  return {
    id: summary.id,
    task_id: taskId,
    status: summary.status,
    reason: summary.reason,
    graph: record?.graph ?? null,
  };
}

async function floorNodeRows(
  floor: FloorRunReads,
  runId: string,
): Promise<NodeRow[]> {
  const visits = await floor.listStationRuns(runId);

  return visits.map((visit) => ({
    assembly_run_id: runId,
    node_id: visit.nodeId,
    iteration: visit.iteration,
    outcome: visit.outcome,
  }));
}

/** Every task Postgres had no run for, tried on the floor; a hit is folded into `runByTask` in place and its node rows handed back for the caller to merge in. */
export async function fillFromFloor(
  floor: FloorRunReads,
  repo: string,
  missing: readonly LoopTaskRow[],
  runByTask: Map<string, LoopRunRow>,
): Promise<NodeRow[]> {
  const found = await Promise.all(
    missing.map((t) => floorRunContext(floor, repo, t.id)),
  );

  return mergeFloorFinds(found, missing, runByTask);
}

function mergeFloorFinds(
  found: ReadonlyArray<{ run: LoopRunRow; nodeRows: NodeRow[] } | null>,
  missing: readonly LoopTaskRow[],
  runByTask: Map<string, LoopRunRow>,
): NodeRow[] {
  const extraNodeRows: NodeRow[] = [];

  found.forEach((result, at) => {
    if (!result) {
      return;
    }
    runByTask.set(missing[at].id, result.run);
    extraNodeRows.push(...result.nodeRows);
  });

  return extraNodeRows;
}
