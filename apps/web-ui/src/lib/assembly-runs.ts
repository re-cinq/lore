// First-class assembly line runs (pipeline.assembly_runs, migration 0025) — the per-attempt records the list/tab/detail pages read through. PR/creator/cost join pipeline.tasks via task_id; task-less runs (code-review family) fall back to args.pr_number/args.actor and the assembly_run_id cost lateral (migration 0032).
import { apiFetch } from "./api/client";
import { sumTurnUsage, type RunTokens, type TurnUsageRow } from "./run-tokens";
import {
  toAssemblyRun,
  toAssemblyRunNode,
  type AssemblyRun,
  type AssemblyRunNode,
  type AssemblyRunNodeRow,
  type AssemblyRunRow,
} from "./assembly-run-rows";

export * from "./assembly-run-rows";

/** lore-api owns the SQL; every read answers empty rather than throwing — a run view is additive, a pre-0025 database must not take a page down. */
async function readRuns(query: string): Promise<AssemblyRun[]> {
  const result = await apiFetch<{ runs: AssemblyRunRow[] }>(
    "lore-api",
    `/api/assembly-lines${query}`,
  );

  if (result.status !== "ok") {
    return [];
  }
  const { runs } = result.data;

  return runs.map(toAssemblyRun);
}

export interface AssemblyRunFilter {
  status?: string;
  repo?: string;
  clusterAgentId?: string;
  limit?: number;
}

/** The run list, filterable by status and repo (both SQL-side). Empty on pre-0025 DBs. */
export async function fetchAssemblyRuns(
  opts: AssemblyRunFilter = {},
): Promise<AssemblyRun[]> {
  return readRuns(`?${assemblyRunFilterParams(opts)}`);
}

function assemblyRunFilterParams(opts: AssemblyRunFilter): URLSearchParams {
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

  return params;
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

  if (result.status !== "ok") {
    return [];
  }
  const { nodes } = result.data;

  return nodes.map(toAssemblyRunNode);
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
