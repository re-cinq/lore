// First-class assembly line runs (pipeline.assembly_lines, migration 0025) — the
// per-attempt execution records, distinct from the task-grouping `AssemblyLine`
// in ./assembly-lines.ts (which chains related task rows). Named AssemblyLineRun
// to keep the two apart until the page re-keys onto run ids.

import { queryAllowMissing } from './db';

/** Raw row shape from pipeline.assembly_lines joined with a node count. */
export interface AssemblyLineRunRow {
  id: string;
  definition_name: string;
  task_id: string | null;
  repo: string;
  branch: string | null;
  status: string;
  outcome: string | null;
  reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  node_count: string;
}

export interface AssemblyLineRun {
  id: string;
  definitionName: string;
  taskId: string | null;
  repo: string;
  branch: string | null;
  status: string;
  outcome: string | null;
  reason: string | null;
  createdAt: string;
  nodeCount: number;
  durationSeconds: number | null;
}

export function toAssemblyLineRun(row: AssemblyLineRunRow): AssemblyLineRun {
  const durationSeconds =
    row.started_at && row.finished_at
      ? Math.round((new Date(row.finished_at).getTime() - new Date(row.started_at).getTime()) / 1000)
      : null;
  return {
    id: row.id,
    definitionName: row.definition_name,
    taskId: row.task_id,
    repo: row.repo,
    branch: row.branch,
    status: row.status,
    outcome: row.outcome,
    reason: row.reason,
    createdAt: row.created_at,
    nodeCount: Number(row.node_count),
    durationSeconds,
  };
}

/** Most-recent runs with their node counts; empty on pre-0025 databases (queryAllowMissing). */
export async function fetchRecentAssemblyLineRuns(limit = 20): Promise<AssemblyLineRun[]> {
  const rows = await queryAllowMissing<AssemblyLineRunRow>(
    `SELECT al.id, al.definition_name, al.task_id, al.repo, al.branch,
            al.status, al.outcome, al.reason, al.created_at, al.started_at, al.finished_at,
            COUNT(n.id)::text AS node_count
       FROM pipeline.assembly_lines al
       LEFT JOIN pipeline.assembly_line_nodes n ON n.assembly_line_id = al.id
      GROUP BY al.id
      ORDER BY al.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toAssemblyLineRun);
}
