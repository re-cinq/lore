import type { RunGraph } from "./run-graph.js";
import type {
  AssemblyRun,
  AssemblyRunStatus,
} from "../../models/assembly-run.js";
import type { StationRun, StationRunInput } from "../../models/station-run.js";

export type { AssemblyRunStatus };

/** AND-filter for list(); empty query = every run, newest first, up to limit. */
export interface AssemblyRunQuery {
  /** Canonical `owner/repo`; caller resolves a repo ID to this name. */
  repo?: string;
  /** One blueprint, or several (the PR-lifecycle choreography asks by family). */
  blueprintName?: string | readonly string[];
  status?: readonly AssemblyRunStatus[];
  taskId?: string;
  /** Matches `args->>'pr_number'`. */
  prNumber?: number;
  /** Runs with an OPEN station-run claimed by this cluster-agent (running-claims drill-down). */
  clusterAgentId?: string;
  /** Every run for one subject regardless of blueprint ("what worked on this feature"). */
  subjectKey?: string;
  createdAfter?: Date;
  /** Defaults to 50. */
  limit?: number;
}

/** Fork parentage: the terminal line to inherit from, and the last node to inherit. */
export interface AssemblyRunResumeFrom {
  lineId: string;
  /** Rows through this node's latest completed row are copied; walk resumes at its successor. */
  nodeId: string;
  /** Copy through exactly this visit instead of latest — back-edges can make latest postdate the retry target. */
  iteration?: number;
}

export interface AssemblyRunStartInput {
  blueprintName: string;
  repo: string;
  branch?: string;
  taskId?: string;
  args?: Record<string, unknown>;
  /** Subject this run works on (e.g. feature:<uuid>); start() is start-or-JOIN — at most one OPEN run per (repo, subjectKey). Optional; omit to allow intentional overlap (comment-triage, code-review-reply). */
  subjectKey?: string;
  /** Content hash of the loaded definition; required with {@link resumeFrom} (drift-guard check). */
  blueprintHash?: string;
  /** Fork-and-rerun (specs/fork-rerun-from-node): seeds new line from source's rows through nodeId; branch/taskId inherited (must not be passed), args inherited unless overridden. */
  resumeFrom?: AssemblyRunResumeFrom;
}

export interface StationRunStartInput {
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  /** CR this visit dispatched, or null when it never will (pooled-service node) — reaper only relaunches missing-CR POD visits, never service visits. */
  agentCrName?: string | null;
  /** Dispatch input, recorded once by the first writer; a re-dispatched duplicate keeps the existing value. */
  input?: StationRunInput;
  /** Pull dispatch (FR3): "queued" parks for cluster-agent claim; default "running" is push-path/backfill meaning. */
  status?: "queued" | "running";
  /** Capability tags a claimant must carry (`required_tags <@ tags`). */
  requiredTags?: string[];
  /** Complete dispatch contract (LoreTaskSpec) stored whole, unlike the bounded `input` record. */
  dispatchSpec?: unknown;
}

/** What a successful claim hands the cluster-agent: visit identity + its dispatch contract. */
export interface ClaimedStationRun {
  nodeRowId: string;
  stationRunId: string;
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  agentCrName: string | null;
  dispatchSpec: unknown;
}

/** Why a visit failed; optional (only "failed" outcomes have one) — avoids a 5th positional arg on every 2-arg caller. */
export interface StationRunFailure {
  failureClass?: string;
  failureDetail?: string;
}

/** One pipeline.station_runs row; shape = StationRun model (see models/station-run.ts). */
export type StationRunRecord = StationRun;

/** The overlap guard's row: everything it compares, nothing it does not. */
export interface OpenRunSummary {
  id: string;
  status: "queued" | "running";
  repo: string;
  branch: string | null;
  subjectKey: string | null;
  createdAt: Date;
}

/** One pipeline.assembly_runs row; shape = AssemblyRun model (see models/assembly-run.ts). */
export type AssemblyRunRecord = AssemblyRun;

/** Run without its blueprint clone (avoids paying transfer for graphs the browse list never draws); a distinct type rather than graph:null, which would collide with "predates clones". */
export type AssemblyRunSummary = Omit<AssemblyRunRecord, "graph">;

/** One line closed by {@link AssemblyRunsPort.finishOpenByPr}; taskId ?? id keys the per-run token/definition reclaim. */
export interface ClosedRunRef {
  id: string;
  taskId: string | null;
}

/** pipeline.assembly_runs + pipeline.station_runs: per-attempt identity for one execution (unlike the retry-stable task id) plus per-node trace. */
export interface AssemblyRunsPort {
  /** Mints assemblyLineId, persists row (status queued) + assembly_line.start event atomically; returns the id. */
  start(input: AssemblyRunStartInput): Promise<string>;
  markRunning(id: string): Promise<void>;
  /** Records the run's blueprint hash+graph once (never overwrites); not passed to start() since callers there never hold a resolved blueprint. Unknown id: Pg no-ops, in-memory double throws (surfaces caller bugs in tests). */
  stampBlueprint(id: string, hash: string, graph?: RunGraph): Promise<void>;
  /** outcome "error" -> failed row, else finished; first writer wins (true), so racers can gate once-only side effects on it. */
  finish(id: string, outcome: string, reason?: string): Promise<boolean>;
  getById(id: string): Promise<AssemblyRunRecord | null>;
  /** Additive merge into the line's args (unmentioned keys untouched, mentioned keys replaced); unknown line id is a no-op, not an error. */
  mergeArgs(id: string, patch: Record<string, unknown>): Promise<void>;
  /** The one filtered read; every finder below wraps it so the SQL exists once. Newest first, id tiebreak. */
  list(query: AssemblyRunQuery): Promise<AssemblyRunRecord[]>;
  /** {@link list} without the blueprint clone, for readers that list rather than draw runs. */
  listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]>;
  listForTask(taskId: string): Promise<AssemblyRunRecord[]>;
  // Event-driven transition primitives: walk state derives from node rows, so concurrent advancers must converge structurally.
  /** Insert-or-noop on the UNIQUE (assembly_run_id, node_id, iteration) key. */
  ensureStationRun(
    input: StationRunStartInput,
  ): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }>;
  /** Compare-and-set the outcome (`WHERE outcome IS NULL`); true when this call won. */
  finishStationRunOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): Promise<boolean>;
  /** The line's node rows in visit order (row id). */
  listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]>;
  // The claim (FR3): atomically takes the oldest queued visit whose required_tags the claimant satisfies, one statement; null when nothing matches.
  /** Arms a queued visit with its dispatch contract; written after ensureStationRun since claim only takes armed rows. */
  enqueueStationRunDispatch(
    nodeRowId: string,
    dispatchSpec: unknown,
  ): Promise<void>;
  claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null>;
  /** Resets a claimed-but-lost visit to queued on the same row; false if it already reached an outcome. */
  requeueStationRun(nodeRowId: string): Promise<boolean>;
  /** Open claims per cluster-agent id (registered-clusters page's "currently executing" column, FR7). */
  countOpenClaimsByAgent(): Promise<Record<string, number>>;
  /** Open (`queued`/`running`) lines, oldest first — the reaper's work list. */
  listOpen(): Promise<AssemblyRunRecord[]>;
  /** Overlap-guard read: open runs on one repo+branch as graph-less summaries; cost must not grow with other branches (unlike listOpen). */
  findOpenOnBranch(repo: string, branch: string): Promise<OpenRunSummary[]>;
  /** The open run on this subject, or null; at most one can exist (store-enforced), unlike {@link findOpenOnBranch}. */
  findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<OpenRunSummary | null>;
  /** Total runs ever on this subject (open or settled) — lets a timer-restarting caller stop, unlike {@link findOpenBySubject}'s in-flight-only answer. */
  countBySubject(repo: string, subjectKey: string): Promise<number>;
  /** Open lines whose args.pr_number matches; not code-review-only — a feature-planning line's spec PR resolves this way too. */
  findOpenByPr(repo: string, prNumber: number): Promise<AssemblyRunRecord[]>;
  /** Closes open lines for repo+PR, returning refs (not a count) so callers can cleanupToken each — else a mid-review close leaks tokens. `definitions` narrows it; PR-lifecycle must pass its own family since feature-planning lines also carry pr_number. */
  finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<ClosedRunRef[]>;
  /** True if any code-review line ever ran for repo+PR — guards against re-reviewing after the first push. */
  hasReviewedPr(repo: string, prNumber: number): Promise<boolean>;
}
