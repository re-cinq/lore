import { enforceTrue } from "../../../lib/enforce.js";
import { randomUUID } from "node:crypto";
import {
  assertSubjectFree,
  forkSubjectKey,
  resolveResumePrefix,
} from "./resume.js";
import { RUN_START_EVENT } from "./run-events.js";
import type { RunGraph } from "../../../domain/run-graph.js";
import {
  StationRunStore,
  type SeedAssemblyLineNode,
} from "./assembly-runs-memory-station-runs.js";
import { AssemblyRunQueryStore } from "./assembly-runs-memory-queries.js";
import {
  inheritFromSource,
  newRunLifecycle,
  resumeRefs,
} from "./assembly-runs-memory-rows.js";
import type {
  AssemblyRunQuery,
  AssemblyRunsPort,
  AssemblyRunStartInput,
  StationRunFailure,
  StationRunStartInput,
  ClaimedStationRun,
  AssemblyRunRecord,
  AssemblyRunSummary,
  StationRunRecord,
  OpenRunSummary,
  ClosedRunRef,
} from "./assembly-runs-port.js";

export type { SeedAssemblyLineNode } from "./assembly-runs-memory-station-runs.js";

export interface SeedAssemblyLineEvent {
  eventName: string;
  source: string;
  params: Record<string, unknown>;
  dedupeKey: string;
}

/** In-memory AssemblyRunsPort — the behavioral spec of the Pg adapter; clock is injectable for deterministic ordering in tests. */
export class InMemoryAssemblyRuns implements AssemblyRunsPort {
  readonly rows: AssemblyRunRecord[] = [];
  readonly events: SeedAssemblyLineEvent[] = [];
  private readonly stationRuns: StationRunStore;
  private readonly queries: AssemblyRunQueryStore;

  constructor(private currentClock: () => Date = () => new Date()) {
    this.stationRuns = new StationRunStore(() => this.clock());
    this.queries = new AssemblyRunQueryStore(
      this.rows,
      () => this.clock(),
      (runId, clusterAgentId) =>
        this.stationRuns.hasOpenClaimByAgent(runId, clusterAgentId),
    );
  }

  /** The clock in force, so a test can put back the one it replaced. */
  get clock(): () => Date {
    return this.currentClock;
  }

  /** Tests advance time by swapping the clock; the seeded rows stay put. */
  setClock(clock: () => Date): void {
    this.currentClock = clock;
  }

  /** Delegates to the station-run store — kept as a field for callers/tests that read `port.nodes` directly. */
  get nodes(): SeedAssemblyLineNode[] {
    return this.stationRuns.nodes;
  }

  /** Validates a resumeFrom fork before minting anything, so a rejected resume leaves no half-created line (mirrors the Pg one-CTE shape). Returns the source row (if any) and the inherited node prefix. */
  private async resolveFork(input: AssemblyRunStartInput): Promise<{
    source: AssemblyRunRecord | null;
    inherited: StationRunRecord[];
  }> {
    const resumeFrom = input.resumeFrom;

    if (!resumeFrom) {
      return { source: null, inherited: [] };
    }
    const { source, prefix } = resolveResumePrefix(
      input,
      await this.getById(resumeFrom.lineId),
      await this.listStationRuns(resumeFrom.lineId),
    );

    await this.assertForkSubjectFree(input, source);

    return { source, inherited: prefix };
  }

  /** The double's stand-in for the Pg in-flight index: a fork may not take over a subject another open run already holds. */
  private async assertForkSubjectFree(
    input: AssemblyRunStartInput,
    source: AssemblyRunRecord,
  ): Promise<void> {
    const subjectKey = forkSubjectKey(input, source);
    const holder = subjectKey
      ? await this.findOpenBySubject(input.repo, subjectKey)
      : null;

    assertSubjectFree(input.repo, subjectKey, holder);
  }

  private recordStartEvent(
    id: string,
    input: AssemblyRunStartInput,
    row: AssemblyRunRecord,
  ): void {
    this.events.push({
      eventName: RUN_START_EVENT,
      source: "internal",
      params: {
        assemblyLineId: id,
        blueprintName: input.blueprintName,
        repo: input.repo,
        branch: row.branch,
        taskId: row.taskId,
        args: row.args,
        resumedFrom: input.resumeFrom ?? null,
      },
      dedupeKey: `${RUN_START_EVENT}:${id}`,
    });
  }

  private async findOpenRunForStart(
    input: AssemblyRunStartInput,
  ): Promise<OpenRunSummary | null> {
    // Start-or-JOIN: a subject already in flight yields its run rather than a second one; the check IS the enforcement here since the double is single-threaded (Pg reaches the same answer via unique-violation). A fork never joins — like the Pg adapter, it is refused by resolveFork instead.
    if (input.resumeFrom || !input.subjectKey) {
      return null;
    }

    return this.findOpenBySubject(input.repo, input.subjectKey);
  }

  /** Stamps a freshly-minted row with fork-derived fields — inherited count, plus source's hash/graph (fork carries source's hash/graph; a plain start carries neither until the Floor stamps them, mirroring the Pg plain-start CTE, and a fork must walk the same graph its hash guard already proved still matches). */
  private applyForkFields(
    row: AssemblyRunRecord,
    source: AssemblyRunRecord | null,
    inherited: StationRunRecord[],
  ): void {
    row.inheritedNodeCount = inherited.length;
    row.blueprintHash = source?.blueprintHash ?? null;
    row.graph = source?.graph ?? null;
  }

  async start(input: AssemblyRunStartInput): Promise<string> {
    const open = await this.findOpenRunForStart(input);

    if (open) {
      return open.id;
    }

    const { source, inherited } = await this.resolveFork(input);
    const id = randomUUID();
    const row = this.newRow(id, inheritFromSource(input, source));

    this.applyForkFields(row, source, inherited);
    this.rows.push(row);
    this.stationRuns.seedInheritedNodes(inherited, id);
    this.recordStartEvent(id, input, row);

    return id;
  }

  async markRunning(id: string): Promise<void> {
    const row = this.mustFind(id);

    // Never resurrect a terminal row (mirrors the Pg guard).
    if (row.status !== "queued" && row.status !== "running") {
      return;
    }

    row.status = "running";
    row.startedAt = this.clock();
  }

  async stampBlueprint(
    id: string,
    hash: string,
    graph?: RunGraph,
  ): Promise<void> {
    const row = this.mustFind(id);

    // Write-once, guarded on hash for both fields (mirrors Pg WHERE) — stamping independently could mismatch graph vs hash.
    if (row.blueprintHash !== null) {
      return;
    }

    row.blueprintHash = hash;
    row.graph = graph ?? null;
  }

  async finish(id: string, outcome: string, reason?: string): Promise<boolean> {
    const row = this.mustFind(id);

    // First writer decides — mirrors the Pg guard on non-terminal status.
    if (row.status !== "queued" && row.status !== "running") {
      return false;
    }

    row.status = outcome === "error" ? "failed" : "finished";
    row.outcome = outcome;
    row.reason = reason ?? null;
    row.finishedAt = this.clock();
    this.stationRuns.strandOpenNodes(id);

    return true;
  }

  ensureStationRun(
    input: StationRunStartInput,
  ): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }> {
    return this.stationRuns.ensureStationRun(input);
  }

  enqueueStationRunDispatch(
    nodeRowId: string,
    dispatchSpec: unknown,
  ): Promise<void> {
    return this.stationRuns.enqueueStationRunDispatch(nodeRowId, dispatchSpec);
  }

  claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null> {
    return this.stationRuns.claimNextStationRun(claimant);
  }

  requeueStationRun(nodeRowId: string): Promise<boolean> {
    return this.stationRuns.requeueStationRun(nodeRowId);
  }

  finishStationRunOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): Promise<boolean> {
    return this.stationRuns.finishStationRunOnce(
      nodeRowId,
      outcome,
      commitSha,
      failure,
    );
  }

  countOpenClaimsByAgent(): Promise<Record<string, number>> {
    return this.stationRuns.countOpenClaimsByAgent();
  }

  listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]> {
    return this.stationRuns.listStationRuns(assemblyRunId);
  }

  findStationRunByAgentCrName(
    agentCrName: string,
  ): Promise<StationRunRecord | null> {
    return this.stationRuns.findStationRunByAgentCrName(agentCrName);
  }

  findStationRunById(stationRunId: string): Promise<StationRunRecord | null> {
    return this.stationRuns.findStationRunById(stationRunId);
  }

  list(query: AssemblyRunQuery): Promise<AssemblyRunRecord[]> {
    return Promise.resolve(this.queries.list(query));
  }

  listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    return Promise.resolve(this.queries.listSummaries(query));
  }

  listOpen(): Promise<AssemblyRunRecord[]> {
    return Promise.resolve(this.queries.listOpen());
  }

  findOpenOnBranch(repo: string, branch: string): Promise<OpenRunSummary[]> {
    return Promise.resolve(this.queries.findOpenOnBranch(repo, branch));
  }

  findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<OpenRunSummary | null> {
    return Promise.resolve(this.queries.findOpenBySubject(repo, subjectKey));
  }

  countBySubject(repo: string, subjectKey: string): Promise<number> {
    return Promise.resolve(this.queries.countBySubject(repo, subjectKey));
  }

  async mergeArgs(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = this.rows.find((r) => r.id === id);

    if (row) {
      row.args = { ...row.args, ...patch };
    }
  }

  async getById(id: string): Promise<AssemblyRunRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  listForTask(taskId: string): Promise<AssemblyRunRecord[]> {
    return Promise.resolve(this.queries.listForTask(taskId));
  }

  findOpenByPr(repo: string, prNumber: number): Promise<AssemblyRunRecord[]> {
    return Promise.resolve(this.queries.findOpenByPr(repo, prNumber));
  }

  finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<ClosedRunRef[]> {
    return Promise.resolve(
      this.queries.finishOpenByPr(repo, prNumber, outcome, definitions),
    );
  }

  hasReviewedPr(repo: string, prNumber: number): Promise<boolean> {
    return Promise.resolve(this.queries.hasReviewedPr(repo, prNumber));
  }

  private newRow(id: string, input: AssemblyRunStartInput): AssemblyRunRecord {
    return {
      id,
      blueprintName: input.blueprintName,
      taskId: input.taskId ?? null,
      repo: input.repo,
      branch: input.branch ?? null,
      subjectKey: input.subjectKey ?? null,
      args: input.args ?? {},
      ...newRunLifecycle(this.clock()),
      ...resumeRefs(input),
    };
  }

  private mustFind(id: string): AssemblyRunRecord {
    const row = this.rows.find((r) => r.id === id);

    enforceTrue(row, Error, `no assembly line "${id}"`);

    return row;
  }
}
