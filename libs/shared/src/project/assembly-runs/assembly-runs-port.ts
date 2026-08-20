import type { RunGraph } from "./run-graph.js";
import type {
  AssemblyRun,
  AssemblyRunStatus,
} from "../../models/assembly-run.js";
import type { StationRun } from "../../models/station-run.js";

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
  agentCrName?: string;
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
  ): Promise<boolean>;
  /** The line's node rows in visit order (row id). */
  listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]>;
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
