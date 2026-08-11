// First-class assembly line runs (pipeline.assembly_lines, migration 0025) — the
// per-attempt execution records that are THE "assembly line" in the UI. The old
// task-chain grouping (the retired lib/assembly-lines.ts) is gone; the list, the
// per-repo tab, and the run detail page all read through here. PR link / creator /
// cost live on pipeline.tasks, joined via task_id. Task-less runs (code-review,
// comment-triage — the webhook-driven family) fall back to args.pr_number for the
// PR link, args.actor (the triggering commenter/reviewer/PR author) for the
// creator, and their llm_calls rows carry the assembly-line id in
// assembly_line_id (migration 0032) for cost. The cost lateral prefers that
// column and falls back to task_id for rows predating it.

import { queryAllowMissing } from "./db";

/** Raw run row: pipeline.assembly_lines LEFT JOIN pipeline.tasks + a cost lateral. */
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
  args_pr_number: number | null;
  pr_url: string | null;
  task_pr_number: number | null;
  created_by: string | null;
  cost_usd: number | null;
  resumed_from_line_id: string | null;
  resumed_from_node_id: string | null;
  inherited_node_count: number;
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
  startedAt: string | null;
  durationSeconds: number | null;
  prUrl: string | null;
  prNumber: number | null;
  createdBy: string | null;
  costUsd: number | null;
  /** Fork parentage (specs/fork-rerun-from-node) — null for a plain start. */
  resumedFromLineId: string | null;
  resumedFromNodeId: string | null;
  /** A fork's inherited prefix is its first N node rows in id order; 0 for a
   *  plain start. Inherited rows carry outcomes but no agent_cr_name, so no
   *  pod logs or agent events exist for them under this run. */
  inheritedNodeCount: number;
}

export interface AssemblyLineRunNodeRow {
  node_id: string;
  iteration: number;
  outcome: string | null;
  agent_cr_name: string | null;
  commit_sha: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AssemblyLineRunNode {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  durationSeconds: number | null;
  /** When the node began — surfaced so a running node shows how long it has been
   *  going instead of a bare "—". Optional so test doubles need not set it; the
   *  DB mapper always does (the column is NOT NULL). */
  startedAt?: string;
}

function durationSeconds(
  startIso: string | null,
  endIso: string | null,
): number | null {
  if (!startIso || !endIso) {
    return null;
  }

  return Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000,
  );
}

export function toAssemblyLineRun(row: AssemblyLineRunRow): AssemblyLineRun {
  // PR link precedence: the backing task's PR, else a code-review run's
  // args.pr_number reconstructed against the repo.
  const prNumber = row.task_pr_number ?? row.args_pr_number;
  const prUrl =
    row.pr_url ??
    (row.args_pr_number !== null
      ? `https://github.com/${row.repo}/pull/${row.args_pr_number}`
      : null);

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
    startedAt: row.started_at,
    durationSeconds: durationSeconds(row.started_at, row.finished_at),
    prUrl,
    prNumber: prNumber ?? null,
    createdBy: row.created_by,
    costUsd: row.cost_usd,
    resumedFromLineId: row.resumed_from_line_id,
    resumedFromNodeId: row.resumed_from_node_id,
    inheritedNodeCount: row.inherited_node_count,
  };
}

export function toAssemblyLineRunNode(
  row: AssemblyLineRunNodeRow,
): AssemblyLineRunNode {
  return {
    nodeId: row.node_id,
    iteration: row.iteration,
    outcome: row.outcome,
    agentCrName: row.agent_cr_name,
    commitSha: row.commit_sha,
    durationSeconds: durationSeconds(row.started_at, row.finished_at),
    startedAt: row.started_at,
  };
}

const RUN_SELECT = `
  SELECT al.id, al.definition_name, al.task_id, al.repo, al.branch,
         al.status, al.outcome, al.reason,
         al.created_at, al.started_at, al.finished_at,
         al.resumed_from_line_id, al.resumed_from_node_id,
         al.inherited_node_count,
         (al.args->>'pr_number')::int AS args_pr_number,
         t.pr_url, t.pr_number AS task_pr_number,
         COALESCE(t.created_by, al.args->>'actor') AS created_by,
         cost.cost_usd
    FROM pipeline.assembly_lines al
    LEFT JOIN pipeline.tasks t ON t.id = al.task_id
    LEFT JOIN LATERAL (
      SELECT SUM(lc.cost_usd)::float AS cost_usd
        FROM pipeline.llm_calls lc
       WHERE lc.assembly_line_id = al.id
          OR (lc.assembly_line_id IS NULL
              AND al.task_id IS NOT NULL
              AND lc.task_id = al.task_id)
    ) cost ON true`;

/** The run list, filterable by status and repo (both SQL-side). Empty on pre-0025 DBs. */
export async function fetchAssemblyLineRuns(
  opts: {
    status?: string;
    repo?: string;
    limit?: number;
  } = {},
): Promise<AssemblyLineRun[]> {
  const rows = await queryAllowMissing<AssemblyLineRunRow>(
    `${RUN_SELECT}
     WHERE ($1::text IS NULL OR al.status = $1)
       AND ($2::text IS NULL OR al.repo = $2)
     ORDER BY al.created_at DESC
     LIMIT $3`,
    [opts.status ?? null, opts.repo ?? null, opts.limit ?? 50],
  );

  return rows.map(toAssemblyLineRun);
}

/** One run by id, or null (also null on pre-0025 DBs so the resolver falls through). */
export async function fetchAssemblyLineRun(
  id: string,
): Promise<AssemblyLineRun | null> {
  const rows = await queryAllowMissing<AssemblyLineRunRow>(
    `${RUN_SELECT} WHERE al.id = $1`,
    [id],
  );

  return rows.length > 0 ? toAssemblyLineRun(rows[0]) : null;
}

/** The run's node executions in visit order. */
export async function fetchAssemblyLineRunNodes(
  id: string,
): Promise<AssemblyLineRunNode[]> {
  const rows = await queryAllowMissing<AssemblyLineRunNodeRow>(
    `SELECT node_id, iteration, outcome, agent_cr_name, commit_sha,
            started_at, finished_at
       FROM pipeline.assembly_line_nodes
      WHERE assembly_line_id = $1
      ORDER BY id`,
    [id],
  );

  return rows.map(toAssemblyLineRunNode);
}
