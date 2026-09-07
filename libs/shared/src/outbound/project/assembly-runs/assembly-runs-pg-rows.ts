import {
  StationRunInputSchema,
  StationRunStatusSchema,
} from "../../../domain/models/station-run.js";
import type { RunGraph } from "../../../domain/run-graph.js";
import type {
  AssemblyRunRecord,
  StationRunRecord,
  OpenRunSummary,
} from "./assembly-runs-port.js";

/** Graph-less projection shared by both open-run reads (avoids listOpen's org-wide graph clone haul). */
export const OPEN_SUMMARY_COLUMNS = `SELECT id, status, repo, branch, subject_key, created_at
         FROM pipeline.assembly_runs`;

export interface OpenRunRow {
  id: string;
  status: "queued" | "running";
  repo: string;
  branch: string | null;
  subject_key: string | null;
  created_at: Date;
}

/** Postgres unique_violation; the subject guard is a partial unique index. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

export function toOpenSummary(row: OpenRunRow): OpenRunSummary {
  return {
    id: row.id,
    status: row.status,
    repo: row.repo,
    branch: row.branch,
    subjectKey: row.subject_key,
    createdAt: new Date(row.created_at),
  };
}

// SUMMARY_TAIL: every toRecord column except id/graph, kept single-sourced so the two read lists cannot drift.
export const SUMMARY_TAIL = `blueprint_name, task_id, repo, branch, subject_key, args, status, outcome, reason,
         blueprint_hash, resumed_from_run_id, resumed_from_node_id, inherited_node_count,
         created_at, started_at, finished_at`;

/** {@link LINE_COLUMNS} without the blueprint clone — see `listSummaries`. */
export const SUMMARY_COLUMNS = `id, ${SUMMARY_TAIL}`;

/** Every column `toRecord` maps, single-sourced so the four read sites cannot drift. */
export const LINE_COLUMNS = `id, graph, ${SUMMARY_TAIL}`;

/** The claim's own columns. A row read before the lifecycle migration has none of them, so `status` falls back to the push-era meaning "running" — the same default the InMemory double uses, or the two would disagree about a pre-migration row. */
function claimFields(row: {
  status?: string | null;
  cluster_agent_id?: string | null;
  required_tags?: string[] | null;
  claimed_at?: Date | null;
}) {
  return {
    status: StationRunStatusSchema.catch("running").parse(
      row.status ?? "running",
    ),
    clusterAgentId: row.cluster_agent_id ?? null,
    requiredTags: row.required_tags ?? [],
    claimedAt: row.claimed_at ?? null,
  };
}

// eslint-disable-next-line max-lines-per-function -- almost all of this is the PARAMETER: one row of pipeline.station_runs spelled out in its stored column names. Splitting it would put half a table's shape in one place and half in another, and the mapping below is one statement per column
export function toNodeRecord(row: {
  id: number | string;
  station_run_id: string;
  assembly_run_id: string;
  node_id: string;
  iteration: number;
  status?: string | null;
  cluster_agent_id?: string | null;
  required_tags?: string[] | null;
  claimed_at?: Date | null;
  outcome: string | null;
  failure_class: string | null;
  failure_detail: string | null;
  agent_cr_name: string | null;
  input: unknown;
  commit_sha: string | null;
  started_at: Date;
  finished_at: Date | null;
}): StationRunRecord {
  return {
    id: String(row.id),
    stationRunId: row.station_run_id,
    assemblyRunId: row.assembly_run_id,
    nodeId: row.node_id,
    iteration: row.iteration,
    ...claimFields(row),
    outcome: row.outcome,
    failureClass: row.failure_class,
    failureDetail: row.failure_detail,
    agentCrName: row.agent_cr_name,
    // A shape the schema rejects reads as "not captured" rather than throwing — this column is diagnostics and must not break the walk.
    input: StationRunInputSchema.nullable()
      .catch(null)
      .parse(row.input ?? null),
    commitSha: row.commit_sha,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

// eslint-disable-next-line max-lines-per-function -- as with toNodeRecord: the length is one row of pipeline.assembly_runs spelled out in stored column names, then one line per column mapping it to the model's own
export function toRecord(row: {
  id: string;
  blueprint_name: string;
  task_id: string | null;
  repo: string;
  branch: string | null;
  subject_key: string | null;
  args: Record<string, unknown> | null;
  status: AssemblyRunRecord["status"];
  outcome: string | null;
  reason: string | null;
  blueprint_hash: string | null;
  graph: RunGraph | null;
  resumed_from_run_id: string | null;
  resumed_from_node_id: string | null;
  inherited_node_count: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}): AssemblyRunRecord {
  return {
    id: row.id,
    blueprintName: row.blueprint_name,
    taskId: row.task_id,
    repo: row.repo,
    branch: row.branch,
    subjectKey: row.subject_key,
    args: row.args ?? {},
    status: row.status,
    outcome: row.outcome,
    reason: row.reason,
    blueprintHash: row.blueprint_hash,
    graph: row.graph,
    resumedFromRunId: row.resumed_from_run_id,
    resumedFromNodeId: row.resumed_from_node_id,
    inheritedNodeCount: row.inherited_node_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
