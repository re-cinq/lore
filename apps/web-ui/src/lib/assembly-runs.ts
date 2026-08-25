// First-class assembly line runs (pipeline.assembly_runs, migration 0025) — the
// per-attempt execution records that are THE "assembly line" in the UI. The old
// task-chain grouping (the retired lib/assembly-lines.ts) is gone; the list, the
// per-repo tab, and the run detail page all read through here. PR link / creator /
// cost live on pipeline.tasks, joined via task_id. Task-less runs (code-review,
// comment-triage — the webhook-driven family) fall back to args.pr_number for the
// PR link, args.actor (the triggering commenter/reviewer/PR author) for the
// creator, and their llm_calls rows carry the assembly-line id in
// assembly_run_id (migration 0032) for cost. The cost lateral prefers that
// column and falls back to task_id for rows predating it.

import type { RunGraph } from "./run-graph";
import { apiFetch } from "./api/client";
import { sumTurnUsage, type RunTokens, type TurnUsageRow } from "./run-tokens";
import type { components } from "./api/schema";

/**
 * Raw run row, as lore-api serves it. NOT restated here: it is an alias over the
 * OpenAPI document generated from that route's own contract (ADR-035), so the
 * shape has one declaration and `scripts/check-openapi-drift.sh` fails CI when
 * the generated artifact goes stale.
 */
export type AssemblyRunRow = Omit<
  components["schemas"]["AssemblyRunDetail"],
  "graph"
> & {
  /** The blueprint clone this run recorded (FR6.38); null for pre-clone rows. */
  graph?: RunGraph | null;
};

export interface AssemblyRun {
  id: string;
  blueprintName: string;
  graph: RunGraph | null;
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

export type AssemblyRunNodeRow =
  components["schemas"]["StationRunList"]["nodes"][number];

/** What a visit was GIVEN, as the run page reads it. Mirrors the lore-api
 *  response shape (web-ui declares its own row types — it imports no server code). */
export interface StationRunInput {
  description: string;
  prompt: string | null;
  params: Record<string, string> | null;
  repo: string;
  ref: string;
}

export interface AssemblyRunNode {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  /** Null for a visit dispatched before the input was recorded. Optional for the
   *  same reason `startedAt` is: test doubles need not set it, the mapper always
   *  does. */
  input?: StationRunInput | null;
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

export function toAssemblyRun(row: AssemblyRunRow): AssemblyRun {
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
    blueprintName: row.blueprint_name,
    graph: row.graph ?? null,
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

export function toAssemblyRunNode(row: AssemblyRunNodeRow): AssemblyRunNode {
  return {
    nodeId: row.node_id,
    iteration: row.iteration,
    outcome: row.outcome,
    agentCrName: row.agent_cr_name,
    input: row.input ?? null,
    commitSha: row.commit_sha,
    durationSeconds: durationSeconds(row.started_at, row.finished_at),
    startedAt: row.started_at,
  };
}

/** Rows come from lore-api, which owns the SQL (the join onto tasks and the cost
 *  lateral moved there verbatim). Every read answers empty rather than throwing:
 *  a run view is additive, and a pre-0025 database must not take a page down. */
async function readRuns(query: string): Promise<AssemblyRun[]> {
  const result = await apiFetch<{ runs: AssemblyRunRow[] }>(
    "lore-api",
    `/api/assembly-lines${query}`,
  );

  return result.status === "ok" ? result.data.runs.map(toAssemblyRun) : [];
}

/** The run list, filterable by status and repo (both SQL-side). Empty on pre-0025 DBs. */
export async function fetchAssemblyRuns(
  opts: {
    status?: string;
    repo?: string;
    limit?: number;
  } = {},
): Promise<AssemblyRun[]> {
  const params = new URLSearchParams();

  if (opts.status) {
    params.set("status", opts.status);
  }

  if (opts.repo) {
    params.set("repo", opts.repo);
  }
  params.set("limit", String(opts.limit ?? 50));

  return readRuns(`?${params}`);
}

/** One run by id, or null (also null on pre-0025 DBs so the resolver falls through). */
export async function fetchAssemblyRun(
  id: string,
): Promise<AssemblyRun | null> {
  const result = await apiFetch<AssemblyRunRow>(
    "lore-api",
    `/api/assembly-lines/${encodeURIComponent(id)}`,
  );

  return result.status === "ok" ? toAssemblyRun(result.data) : null;
}

/** The newest run for a task, or null. A task-centric page (the feature planning
 *  wizard) knows only its task id — the run it should visualize is the latest
 *  attempt, since a retry mints a fresh row against the same task. */
export async function fetchLatestRunForTask(
  taskId: string,
): Promise<AssemblyRun | null> {
  const runs = await readRuns(`?task_id=${encodeURIComponent(taskId)}&limit=1`);

  return runs[0] ?? null;
}

/** The run's node executions in visit order. */
export async function fetchAssemblyRunNodes(
  id: string,
): Promise<AssemblyRunNode[]> {
  const result = await apiFetch<{ nodes: AssemblyRunNodeRow[] }>(
    "lore-api",
    `/api/assembly-lines/${encodeURIComponent(id)}/nodes`,
  );

  return result.status === "ok" ? result.data.nodes.map(toAssemblyRunNode) : [];
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

  const result = await apiFetch<{ usage: TurnUsageRow | null }>(
    "lore-api",
    `/api/assembly-lines/${encodeURIComponent(assemblyLineId)}/token-usage`,
  );

  if (result.status !== "ok" || !result.data.usage) {
    return null;
  }
  const summed = sumTurnUsage([result.data.usage]);

  // The aggregate always answers one row; an all-zero one means no usage yet.
  return summed && summed.total > 0 ? summed : null;
}
