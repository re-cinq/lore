// The run page's row shapes and the pure mappers from lore-api's wire rows — no server imports, so the client-side reducers can use them (the reads live in assembly-runs.ts).
import type { RunGraph } from "./run-graph";
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
  issueUrl: string | null;
  issueNumber: number | null;
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

export function durationSeconds(
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
    createdBy: row.created_by,
    costUsd: row.cost_usd,
    ...issueRef(row),
    ...pullRequestRef(row),
  };
}

/** The backing task's Issue, straight off the run-row enrichment's task join. */
function issueRef(
  row: AssemblyRunRow,
): Pick<AssemblyRun, "issueUrl" | "issueNumber"> {
  return { issueUrl: row.issue_url, issueNumber: row.issue_number };
}

/** PR link precedence: the backing task's PR, else a code-review run's args.pr_number reconstructed against the repo. */
function pullRequestRef(
  row: AssemblyRunRow,
): Pick<AssemblyRun, "prUrl" | "prNumber"> {
  const prUrl =
    row.pr_url ??
    (row.args_pr_number !== null
      ? `https://github.com/${row.repo}/pull/${row.args_pr_number}`
      : null);

  return { prUrl, prNumber: row.task_pr_number ?? row.args_pr_number ?? null };
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
