// A loop task's run and node visits: Postgres first, the floor on a miss (every implementation-loop run has lived there since ADR-049).
import type { Pool } from "pg";
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import type { FloorRunReads } from "../../../work/floor/floor-backed-runs.js";
import type { LoopRunRow, LoopTaskRow, NodeRow } from "./backlog-ticket.js";

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
