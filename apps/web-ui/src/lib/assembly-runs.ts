// First-class assembly line runs (pipeline.assembly_runs, migration 0025) — the per-attempt records the list/tab/detail pages read through. PR/creator/cost join pipeline.tasks via task_id; task-less runs (code-review family) fall back to args.pr_number/args.actor and the assembly_run_id cost lateral (migration 0032).
import type { RunGraph } from "./run-graph";
import { apiFetch } from "./api/client";
import { sumTurnUsage, type RunTokens, type TurnUsageRow } from "./run-tokens";
import type { components } from "./api/schema";

/** Raw run row — aliases the OpenAPI document generated from lore-api's route contract (ADR-035); check-openapi-drift.sh guards staleness. */
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

/** What a visit was GIVEN, as the run page reads it — mirrors lore-api's response shape (web-ui imports no server code). */
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
  /** Null for a visit dispatched before input was recorded; optional so test doubles need not set it (the mapper always does). */
  input?: StationRunInput | null;
  commitSha: string | null;
  durationSeconds: number | null;
  /** When the node began, so a running node shows elapsed time instead of "—"; optional for test doubles, the DB mapper always sets it. */
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
  // PR link precedence: the backing task's PR, else a code-review run's args.pr_number reconstructed against the repo.
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

/** lore-api owns the SQL; every read answers empty rather than throwing — a run view is additive, a pre-0025 database must not take a page down. */
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
    clusterAgentId?: string;
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

  if (opts.clusterAgentId) {
    params.set("cluster_agent_id", opts.clusterAgentId);
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

/** Newest run for a task, or null — a task-centric page (feature planning wizard) knows only its task id, and a retry mints a fresh row against the same task. */
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

/** A line's usage so far, or null on no-usage-yet/any error (a pre-0037 DB included) — reads `pipeline.agent_run_turns`, not `llm_calls`, since turns arrive mid-stream while a cost row lands only when the run ends; summed SQL-side (migration 0037 grants `lore_ui` SELECT). */
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
