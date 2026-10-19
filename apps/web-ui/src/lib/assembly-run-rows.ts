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

/** One stage of a run as the list draws it: the node and its state. */
export interface PipelineNode {
  node_id: string;
  state: string;
}

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
  /** The spec analysis's summary: the question a planning line's author must answer while the line waits on them. Optional so test doubles need not set it; the mapper always does. */
  specPlanSummary?: string | null;
  issueUrl: string | null;
  issueNumber: number | null;
  createdBy: string | null;
  costUsd: number | null;
  /** Which engine walks the run: `floor` for one on the external floor. Optional so test doubles need not set it; the mapper always does. */
  engine?: string;
  /** The run's stages as the list draws them; optional so test doubles need not set it. */
  pipeline?: PipelineNode[];
}

const FLOOR_ENGINE = "floor";

/** True for a run the external floor walks: the run page reads and watches it, and asks the floor to run one of its nodes again. */
export function isFloorEngine(engine: string | undefined): boolean {
  return engine === FLOOR_ENGINE;
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
  /** The node's own words about why it stopped; optional so test doubles need not set it. */
  failureDetail?: string | null;
  agentCrName: string | null;
  /** Null for a visit dispatched before input was recorded; optional so test doubles need not set it (the mapper always does). */
  input?: StationRunInput | null;
  /** The visit's id on its engine; the per-visit reads (events, model calls) are keyed by it. Optional for test doubles. */
  stationRunId?: string | null;
  /** What the visit reported it produced, name → value or blob hash; null until it reports. */
  produced?: Record<string, string> | null;
  /** A human station's page for this visit; null when it names none. */
  routeUrl?: string | null;
  /** Who reported the visit: a worker, `station:<name>`, a person, or `event:<name>`. */
  worker?: string | null;
  /** The person or event that ran the node by hand; null when the walk opened it. */
  requestedBy?: string | null;
  /** When the visit finished; null while it is open. */
  finishedAt?: string | null;
  /** The bag as the pod saw it at start — the floor brief's needs, name → ref; null for a visit Lore's own engine walked. Optional for test doubles, the mapper always sets it. */
  needs?: Record<string, string> | null;
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
    engine: row.engine,
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
    ...linkedWork(row),
  };
}

// What the run points at beyond itself: its Issue, its PR, and the spec analysis's summary.
function linkedWork(
  row: AssemblyRunRow,
): Pick<
  AssemblyRun,
  "issueUrl" | "issueNumber" | "prUrl" | "prNumber" | "specPlanSummary"
> {
  return {
    ...issueRef(row),
    ...pullRequestRef(row),
    specPlanSummary: row.spec_plan_summary ?? null,
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
    failureDetail: row.failure_detail,
    agentCrName: row.agent_cr_name,
    input: row.input ?? null,
    needs: row.needs ?? null,
    ...visitFactsOf(row),
    commitSha: row.commit_sha,
    durationSeconds: durationSeconds(row.started_at, row.finished_at),
    startedAt: row.started_at,
  };
}

/** What a floor visit adds to its row: its id, what it produced, its page, who reported it, who ran it by hand, and when it finished. */
function visitFactsOf(row: AssemblyRunNodeRow) {
  return {
    stationRunId: row.station_run_id,
    produced: row.produced,
    routeUrl: row.route_url,
    worker: row.worker,
    requestedBy: row.requested_by,
    finishedAt: row.finished_at,
  };
}

/** A run row of the floor's run list as lore-api serves it: the list row plus its stages. */
export type FloorRunRow = components["schemas"]["FloorRunPage"]["runs"][number];

/** A floor run row — from a page or from a live `run_row` frame — as the list draws it, stages included. */
export function floorRunOf(row: FloorRunRow): AssemblyRun {
  return { ...toAssemblyRun({ ...row, graph: null }), pipeline: row.pipeline };
}
