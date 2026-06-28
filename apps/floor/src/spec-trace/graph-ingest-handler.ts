/**
 * Cluster-side handler for `execution_mode: graph-ingest` tasks. The agent
 * worker dispatches here BEFORE the LLM ladder — these tasks are deterministic
 * (no Issue, no PR, no Claude Code). It drives the task through its real status
 * lifecycle (queued → running → completed | failed) + a task_events row per
 * transition so the UI reflects the run, and persists the run summary to
 * `context_bundle.ingest_summary` (a jsonb merge — `context_bundle` is not a
 * setStatus-allowlisted column) plus the closing event meta. The actual
 * projection is the shared, runtime-agnostic `runIngestGraph`; only the injected
 * deps (pool / repo reader / dgraph) differ from the local path.
 */

import {
  runIngestGraph,
  setTaskStatus,
  recordTaskEvent,
  type IngestGraphSummary,
  type IngestKind,
  type DgraphClientPort,
  type PgPool,
} from "@re-cinq/lore-shared";

interface GraphIngestTask {
  id: string;
  target_branch?: string | null;
  context_bundle?: { kind?: IngestKind; branch?: string; commit?: string; glob?: string; force?: boolean } | null;
}

export interface RepoReader {
  tree(ref?: string): Promise<string[]>;
  read(path: string, ref?: string): Promise<string | null>;
}

/**
 * The runtime-agnostic projection core: reads the repo's files via the injected
 * reader and projects `kind` into the graph. Shared by the task path
 * ({@link handleGraphIngest}) and the trigger path (spec-trace-dispatch) so both
 * wire `runIngestGraph` the same way.
 */
export async function projectRepoGraph(
  params: { kind: IngestKind; repo: string; ref?: string; glob?: string; force?: boolean },
  deps: { repo: RepoReader; dgraph: DgraphClientPort | null },
): Promise<IngestGraphSummary> {
  return runIngestGraph(params, {
    dgraph: deps.dgraph,
    listTree: (r) => deps.repo.tree(r),
    readFile: async (path, r) => (await deps.repo.read(path, r)) ?? "",
  });
}

export interface GraphIngestDeps {
  pool: PgPool;
  project: { repo: RepoReader };
  dgraph: DgraphClientPort | null;
}

export async function handleGraphIngest(
  task: GraphIngestTask,
  targetRepo: string,
  agentId: string,
  deps: GraphIngestDeps,
): Promise<IngestGraphSummary> {
  const { pool, project, dgraph } = deps;
  const cb = task.context_bundle ?? {};
  const kind: IngestKind = cb.kind ?? "specs";
  // Pin to the task's commit/branch (cluster reads at this ref via the GitHub API).
  const ref = cb.commit || cb.branch || task.target_branch || undefined;

  await setTaskStatus(pool, task.id, "queued", { agent_id: agentId });
  await recordTaskEvent(pool, task.id, "pending", "queued", { kind });
  await setTaskStatus(pool, task.id, "running");
  await recordTaskEvent(pool, task.id, "queued", "running");

  try {
    // No buildTestReport on the cluster → an ingest-tests task self-skips.
    const summary = await projectRepoGraph(
      { kind, repo: targetRepo, ref, glob: cb.glob, force: cb.force },
      { repo: project.repo, dgraph },
    );
    const status = summary.status === "failed" ? "failed" : "completed";
    await pool.query(
      `UPDATE pipeline.tasks SET context_bundle = COALESCE(context_bundle, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ ingest_summary: summary }), task.id],
    );
    await setTaskStatus(pool, task.id, status);
    await recordTaskEvent(pool, task.id, "running", status, summary as unknown as Record<string, unknown>);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setTaskStatus(pool, task.id, "failed", { failure_reason: message });
    await recordTaskEvent(pool, task.id, "running", "failed", { error: message });
    throw err;
  }
}
