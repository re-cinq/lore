import type { RunGraph } from "./run-graph.js";
import type {
  AssemblyRun,
  AssemblyRunStatus,
} from "../../models/assembly-run.js";
import type { StationRun, StationRunInput } from "../../models/station-run.js";

export type { AssemblyRunStatus };

/**
 * The filter `list` accepts. Every field is optional and ANDed; an empty query
 * is "every run, newest first, up to the limit".
 */
export interface AssemblyRunQuery {
  /** Canonical `owner/repo`. A repo ID is resolved to this by the caller — the
   *  run stores the name, as every repo-scoped port here does. */
  repo?: string;
  /** One blueprint, or several (the PR-lifecycle choreography asks by family). */
  blueprintName?: string | readonly string[];
  status?: readonly AssemblyRunStatus[];
  taskId?: string;
  /** Matches `args->>'pr_number'`. */
  prNumber?: number;
  /** Every run for one subject, whatever its blueprint — "what has worked on
   *  this feature", which nothing could ask for while the only key was a task id
   *  and a blueprint name. */
  subjectKey?: string;
  createdAfter?: Date;
  /** Defaults to 50. */
  limit?: number;
}

/** Fork parentage: the terminal line to inherit from, and the last node to inherit. */
export interface AssemblyRunResumeFrom {
  lineId: string;
  /** Rows through THIS node's latest completed row are copied; the walk resumes
   *  at its successor. */
  nodeId: string;
}

export interface AssemblyRunStartInput {
  blueprintName: string;
  repo: string;
  branch?: string;
  taskId?: string;
  args?: Record<string, unknown>;
  /**
   * What this run is working ON — `feature:<uuid>`, `detect:<blueprint>:<repo>`,
   * `ingest:<kind>:<ref>[:<chunk>]`. At most one OPEN run may hold a given
   * (repo, subjectKey), so `start` is start-or-JOIN: a second caller for a
   * subject already in flight gets the id of the run already working it rather
   * than a second run.
   *
   * The SUBJECT, never the action. `feature:<id>` is what lets one query find
   * that feature's planning run and its finalize run; `feature:<id>:finalize`
   * would guard repeat finalizes while still allowing two lines to work one
   * feature at once, which is the thing that actually went wrong.
   *
   * Optional, and opt-in by design: a run with no key is unconstrained. Lines
   * that are MEANT to overlap — comment-triage and code-review-reply carry
   * distinct human comments on one branch — simply pass nothing, which replaces
   * the old opt-out-by-blueprint-name list.
   */
  subjectKey?: string;
  /** Content hash of the definition the caller loaded. Required with
   *  {@link resumeFrom} — it is the drift guard's left-hand side. */
  blueprintHash?: string;
  /**
   * Fork-and-rerun (specs/fork-rerun-from-node): seed the new line with the
   * source's node rows through `nodeId`, so the ordinary replay-derived walk
   * resumes at the successor instead of re-running the green prefix. `branch`
   * and `taskId` are inherited and must not be passed; `args` are inherited
   * unless overridden.
   */
  resumeFrom?: AssemblyRunResumeFrom;
}

export interface StationRunStartInput {
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  /**
   * The CR this visit dispatched, or NULL when it will never have one.
   *
   * Null is not "unknown": it says the node runs in the pooled service and was
   * published on the bus. The reaper reads exactly that — a missing CR on a POD
   * visit is the crash-between-row-and-launch case and gets relaunched, while
   * relaunching a service visit would run a pod alongside the delivery still
   * queued for it.
   */
  agentCrName?: string | null;
  /** What this visit is being dispatched WITH — recorded once, by the first
   *  writer: a converged duplicate (the relaunch door re-dispatching the same
   *  visit) keeps what the row already says rather than rewriting history. */
  input?: StationRunInput;
  /** Pull-based dispatch (specs/running-stations-in-any-k8s-cluster FR3):
   *  `queued` parks the row for a cluster-agent's claim; the default `running`
   *  is the push path's meaning and the pre-flip rows' backfill. */
  status?: "queued" | "running";
  /** Capability tags a claimant must carry (`required_tags <@ tags`). */
  requiredTags?: string[];
  /** The complete machine dispatch contract (LoreTaskSpec) a claimant runs
   *  with. Stored whole — unlike `input`, which is the bounded human record. */
  dispatchSpec?: unknown;
}

/** What a successful claim hands the cluster-agent: the visit's identity and
 *  the complete dispatch contract it was enqueued with. */
export interface ClaimedStationRun {
  nodeRowId: string;
  stationRunId: string;
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  agentCrName: string | null;
  dispatchSpec: unknown;
}

/**
 * WHY a visit failed, recorded alongside its outcome. Optional because only a
 * `failed` outcome has one — and because the alternative, a fifth positional
 * argument, would have every existing two-argument caller reading as if it were
 * declining to classify.
 */
export interface StationRunFailure {
  failureClass?: string;
  failureDetail?: string;
}

/**
 * One `pipeline.station_runs` row. The shape is the `StationRun` model — see
 * `libs/shared/src/models/station-run.ts` for the columns it binds and why a
 * visit carries two ids.
 */
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

/**
 * One `pipeline.assembly_runs` row. The shape is the `AssemblyRun` model — see
 * `libs/shared/src/models/assembly-run.ts` for the columns it binds, the
 * blueprint-clone `graph`, and why `repo` is the `owner/repo` string.
 */
export type AssemblyRunRecord = AssemblyRun;

/**
 * A run WITHOUT its blueprint clone.
 *
 * The browse list renders tables that never draw the graph, so reading up to
 * `limit` clones per page is transfer paid for nothing. Stated as a narrower
 * TYPE rather than as a `graph: null` on the full record: a null that means "not
 * read" is indistinguishable from a null that means "this run predates clones",
 * and the second is a real state a reader has to handle.
 */
export type AssemblyRunSummary = Omit<AssemblyRunRecord, "graph">;

/**
 * `pipeline.assembly_runs` + `pipeline.station_runs` — first-class
 * identity for one assembly line execution (per attempt, unlike the task id
 * which is stable across retries) plus the per-node trace.
 */
export interface AssemblyRunsPort {
  /**
   * Mint a fresh assemblyLineId, persist the row (status `queued`), and insert
   * the `assembly_line.start` event in the same atomic statement so the Floor
   * event loop picks the assembly line up. Returns the assemblyLineId.
   */
  start(input: AssemblyRunStartInput): Promise<string>;
  markRunning(id: string): Promise<void>;
  /**
   * Record WHICH blueprint this run executes — its content hash and the cloned
   * graph — once.
   *
   * Stamped here rather than passed to {@link start} because this is the only
   * moment that holds both the row id and a RESOLVED blueprint: `start` is called
   * by lore-api and by choreographies that deliberately do not ship the
   * definitions, so a graph parameter there could only ever be null.
   *
   * Never overwrites an already-stamped value. The pair names the graph this
   * run's station rows were produced by, so a redelivered start that loaded a
   * since-edited blueprint must not rewrite what the rows actually came from.
   *
   * Unknown id: the Pg UPDATE simply matches no row, while the in-memory double
   * throws — the same deliberate asymmetry `markRunning` carries, so a caller
   * bug surfaces in tests instead of vanishing in production.
   */
  stampBlueprint(id: string, hash: string, graph?: RunGraph): Promise<void>;
  /** `outcome: "error"` closes the row as `failed`; anything else as `finished`.
   *  First writer decides — returns true only for the call that closed the row,
   *  so racing finishers (node event vs reaper) can gate once-only side effects
   *  (failure notification) on the win. */
  finish(id: string, outcome: string, reason?: string): Promise<boolean>;
  getById(id: string): Promise<AssemblyRunRecord | null>;
  /**
   * Merge a patch into the line's `args` — how one node's output reaches the next,
   * and how a node's objection reaches the node that fed it.
   *
   * ADDITIVE by key: a key the patch does not mention is untouched, so a later merge
   * can never make an earlier node's input vanish from under the replay. A key the
   * patch DOES mention is replaced, because an upstream node re-running after an
   * objection must supersede the output that was rejected. A line that does not
   * exist is a no-op, not an error: the artifact sink is fire-and-forget.
   */
  mergeArgs(id: string, patch: Record<string, unknown>): Promise<void>;
  /**
   * The ONE filtered read. Every finder below is a one-line caller of it, so the
   * SQL exists once — before this, "every code-review run on this repo" had no
   * answer at all, because the port only offered lookups by task, by PR, and by
   * openness. Newest first, id as the tiebreak so the order is total.
   */
  list(query: AssemblyRunQuery): Promise<AssemblyRunRecord[]>;
  /** {@link list}, selecting the same runs in the same order but without the
   *  blueprint clone — for readers that list runs rather than draw them. */
  listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]>;
  listForTask(taskId: string): Promise<AssemblyRunRecord[]>;
  /**
   * Event-driven transition primitives: the walk state is derived from node rows,
   * so duplicate/concurrent advancers must converge structurally.
   */
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
  /**
   * The claim (FR3): atomically take the oldest `queued` open visit whose
   * `required_tags` the claimant's tags satisfy — one statement, so concurrent
   * claimants are safe — or null when nothing matches.
   */
  /**
   * Arm a queued visit with its complete dispatch contract. Written after
   * `ensureStationRun` because the contract carries the minted stationRunId;
   * the claim takes only armed rows, so a crash between the two leaves a row
   * the queue-wait bound settles rather than a claim with nothing to run.
   */
  enqueueStationRunDispatch(
    nodeRowId: string,
    dispatchSpec: unknown,
  ): Promise<void>;
  claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null>;
  /**
   * Reset a claimed-but-lost visit back to `queued` on the SAME row (the
   * row-id-as-visit-order contract), clearing the claim; false when the visit
   * already reached an outcome.
   */
  requeueStationRun(nodeRowId: string): Promise<boolean>;
  /** Open claims per cluster-agent id — the registered-clusters page's
   *  "currently executing" column (FR7). */
  countOpenClaimsByAgent(): Promise<Record<string, number>>;
  /** Open (`queued`/`running`) lines, oldest first — the reaper's work list. */
  listOpen(): Promise<AssemblyRunRecord[]>;
  /**
   * The overlap guard's read: open runs on one repo+branch, oldest first, as
   * graph-less summaries. `listOpen` hauls every open run's graph clone org-wide;
   * the guard compares five scalars, and its cost must not grow with runs on
   * OTHER branches.
   */
  findOpenOnBranch(repo: string, branch: string): Promise<OpenRunSummary[]>;
  /**
   * The open run working this subject, or null.
   *
   * At most one can exist — the store enforces it — so this returns a single row
   * rather than a list, unlike {@link findOpenOnBranch}, whose branch key never
   * carried that guarantee. Callers answer "already in flight" with the id they
   * get back, which is what lets a rejected duplicate request still name the run
   * the caller should be watching.
   */
  findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<OpenRunSummary | null>;
  /**
   * How many runs — open or settled — have ever worked this subject.
   *
   * {@link findOpenBySubject} answers "is one in flight", which is the wrong
   * question for a caller that re-starts on a timer: a line that fails at its
   * first node settles, so the open lookup is empty again a minute later and
   * the caller starts another. Counting every attempt is what lets such a
   * caller stop.
   */
  countBySubject(repo: string, subjectKey: string): Promise<number>;
  /**
   * Open (`queued`/`running`) assembly lines whose `args.pr_number` matches — the
   * PR-scoped lookup the code-review choreography uses. NOT only code-review lines:
   * a feature-planning line carries the spec PR it pushed, which is how a merge
   * finds the line parked on `merged`.
   */
  findOpenByPr(repo: string, prNumber: number): Promise<AssemblyRunRecord[]>;
  /**
   * Close open lines for the repo+PR with `outcome`; returns the count closed.
   *
   * `definitions` NARROWS it to those definition names, and the PR-lifecycle
   * choreography must pass its own family. The unfiltered form used to be safe
   * because only code-review lines carried `pr_number` in args — an invariant that
   * ended when the push node began stamping the spec PR on the FEATURE-PLANNING
   * line. Merging a spec PR then closed the very line that was parked waiting for
   * that merge, one step before decomposition.
   */
  finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<number>;
  /**
   * True when any `code-review` line (any status) has ever run for the repo+PR —
   * the first-review-only guard so pushes after the first review don't re-review.
   */
  hasReviewedPr(repo: string, prNumber: number): Promise<boolean>;
}
