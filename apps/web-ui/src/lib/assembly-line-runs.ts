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
import { sumTurnUsage, type RunTokens, type TurnUsageRow } from "./run-tokens";

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

/** The newest run for a task, or null. A task-centric page (the feature planning
 *  wizard) knows only its task id — the run it should visualize is the latest
 *  attempt, since a retry mints a fresh row against the same task. */
export async function fetchLatestRunForTask(
  taskId: string,
): Promise<AssemblyLineRun | null> {
  const rows = await queryAllowMissing<AssemblyLineRunRow>(
    `${RUN_SELECT} WHERE al.task_id = $1 ORDER BY al.created_at DESC LIMIT 1`,
    [taskId],
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

/**
 * A line's usage so far, or null when it has reported none yet (and on any error:
 * the wizard's poll must keep reporting the round's status even when usage is
 * unavailable — a pre-0037 database included).
 *
 * `pipeline.agent_run_turns`, NOT `pipeline.llm_calls`: the cost table is
 * authoritative and carries dollars, but a row lands only when an agent run ENDS,
 * which for a planning round is the moment the card showing the number disappears.
 * Turns arrive while the pod streams, so they are the only source that can answer
 * "so far" while something is still running. `lore_ui` is granted SELECT on the
 * table by migration 0037.
 *
 * The usage object rides inside the untruncated envelope, so the extraction is
 * SQL-side: summing four scalars beats shipping every turn of a long run to Node
 * every four seconds.
 */
export async function fetchRunTokens(
  assemblyLineId: string | null | undefined,
): Promise<RunTokens | null> {
  if (!assemblyLineId) {
    return null;
  }

  try {
    const rows = await queryAllowMissing<TurnUsageRow>(
      `SELECT
         COALESCE(SUM((usage->>'input_tokens')::bigint), 0)::int AS input_tokens,
         COALESCE(SUM((usage->>'output_tokens')::bigint), 0)::int AS output_tokens,
         COALESCE(SUM((usage->>'cache_creation_input_tokens')::bigint), 0)::int
           AS cache_creation_tokens,
         COALESCE(SUM((usage->>'cache_read_input_tokens')::bigint), 0)::int
           AS cache_read_tokens
       FROM (
         SELECT envelope->'event'->'message'->'usage' AS usage
           FROM pipeline.agent_run_turns
          WHERE assembly_line_id = $1
            AND envelope->'event'->'message' ? 'usage'
       ) turns`,
      [assemblyLineId],
    );
    const summed = sumTurnUsage(rows);

    // The aggregate always answers one row; an all-zero one means no usage yet.
    return summed && summed.total > 0 ? summed : null;
  } catch {
    return null;
  }
}
