import type { StationRunInput } from "../../models/station-run.js";
import { enforceTrue } from "../../lib/enforce.js";
import { randomUUID } from "node:crypto";
import { resolveResumePrefix } from "./resume.js";
import { RUN_START_EVENT } from "./run-events.js";
import type { RunGraph } from "./run-graph.js";
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

export interface SeedAssemblyLineEvent {
  eventName: string;
  source: string;
  params: Record<string, unknown>;
  dedupeKey: string;
}

export interface SeedAssemblyLineNode {
  id: string;
  stationRunId: string;
  assemblyRunId: string;
  nodeId: string;
  iteration: number;
  agentCrName: string | null;
  input: StationRunInput | null;
  /** Optional (pre-flip test seeds); readers default to push-era meaning (running, no claim, no tags). */
  status?: "queued" | "claimed" | "running";
  clusterAgentId?: string | null;
  requiredTags?: string[];
  claimedAt?: Date | null;
  outcome: string | null;
  failureClass: string | null;
  failureDetail: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** The graph-less projection the two open-run reads hand back. */
function toOpenSummary(row: AssemblyRunRecord): OpenRunSummary {
  return {
    id: row.id,
    status: row.status as "queued" | "running",
    repo: row.repo,
    branch: row.branch,
    subjectKey: row.subjectKey,
    createdAt: row.createdAt,
  };
}

/** Fork inherits branch/taskId/subject (+args unless overridden) from source — the subject rides along because a fork re-runs the same work and must hold its source's guard (legal only from a terminal run). */
function inheritFromSource(
  input: AssemblyRunStartInput,
  source: AssemblyRunRecord | null,
): AssemblyRunStartInput {
  if (!source) {
    return input;
  }

  return {
    ...input,
    branch: source.branch ?? undefined,
    taskId: source.taskId ?? undefined,
    subjectKey: input.subjectKey ?? source.subjectKey ?? undefined,
    args: input.args ?? source.args,
  };
}

/** In-memory AssemblyRunsPort — the behavioral spec of the Pg adapter; clock is injectable for deterministic ordering in tests. */
export class InMemoryAssemblyRuns implements AssemblyRunsPort {
  rows: AssemblyRunRecord[] = [];
  nodes: SeedAssemblyLineNode[] = [];
  private readonly dispatchSpecs = new Map<string, unknown>();
  events: SeedAssemblyLineEvent[] = [];

  constructor(public clock: () => Date = () => new Date()) {}

  async start(input: AssemblyRunStartInput): Promise<string> {
    // Start-or-JOIN: a subject already in flight yields its run rather than a second one; the check IS the enforcement here since the double is single-threaded (Pg reaches the same answer via unique-violation).
    const open = input.subjectKey
      ? await this.findOpenBySubject(input.repo, input.subjectKey)
      : null;

    if (open) {
      return open.id;
    }

    const resumeFrom = input.resumeFrom;
    const source = resumeFrom ? await this.getById(resumeFrom.lineId) : null;
    // Validate the fork before minting anything, so a rejected resume leaves no half-created line (mirrors the Pg one-CTE shape).
    const inherited = resumeFrom
      ? resolveResumePrefix(
          input,
          source,
          await this.listStationRuns(resumeFrom.lineId),
        ).prefix
      : [];
    const id = randomUUID();
    const row = this.newRow(id, inheritFromSource(input, source));

    row.inheritedNodeCount = inherited.length;
    // Fork carries source's hash; plain start carries none until the Floor stamps it (Pg plain-start CTE likewise never writes it).
    row.blueprintHash = source?.blueprintHash ?? null;
    // Fork replays source's rows, so it must walk the same graph (hash guard already proved the blueprint still matches).
    row.graph = source?.graph ?? null;
    this.rows.push(row);

    for (const node of inherited) {
      this.nodes.push({
        ...node,
        id: String(this.nodes.length + 1),
        // Copied row is of THIS run, so it gets its own identity — sharing a station_run_id would merge telemetry.
        stationRunId: randomUUID(),
        assemblyRunId: id,
        // Copied rows never carry the source's CR name — run-viz/cost joins resolve by newest node row, so an echoed name would steal late-arriving source rows.
        agentCrName: null,
        // Nor its verdict — getNextTransition replays the copied prefix and would fail the fork on an inherited permanent-failure visit on first advance.
        failureClass: null,
        failureDetail: null,
      });
    }
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

    // A visit still open under a finishing run is stranded: the reaper sweeps only OPEN runs, so nothing would ever close it, and the spend page bills an unfinished visit at its cap. A visit that DID report keeps its own outcome.
    for (const node of this.nodes) {
      if (node.assemblyRunId === id && node.finishedAt === null) {
        node.finishedAt = this.clock();
        node.outcome = node.outcome ?? "failed";
        node.failureClass = node.failureClass ?? "unknown";
        node.failureDetail =
          node.failureDetail ??
          "the run finished while this visit was still open — the visit never reported an outcome";
      }
    }

    return true;
  }

  private async recordNodeStart(input: StationRunStartInput): Promise<string> {
    const id = String(this.nodes.length + 1);

    if (input.dispatchSpec !== undefined) {
      this.dispatchSpecs.set(id, input.dispatchSpec);
    }
    this.nodes.push({
      id,
      stationRunId: randomUUID(),
      assemblyRunId: input.assemblyRunId,
      nodeId: input.nodeId,
      iteration: input.iteration,
      agentCrName: input.agentCrName ?? null,
      input: input.input ?? null,
      status: input.status ?? "running",
      clusterAgentId: null,
      requiredTags: input.requiredTags ?? [],
      claimedAt: null,
      outcome: null,
      failureClass: null,
      failureDetail: null,
      commitSha: null,
      startedAt: this.clock(),
      finishedAt: null,
    });

    return id;
  }

  private async recordNodeFinish(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeRowId);

    enforceTrue(node, Error, `no assembly line node row "${nodeRowId}"`);
    node.outcome = outcome;
    node.commitSha = commitSha ?? null;
    node.failureClass = failure?.failureClass ?? null;
    node.failureDetail = failure?.failureDetail ?? null;
    node.finishedAt = this.clock();
  }

  async ensureStationRun(
    input: StationRunStartInput,
  ): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }> {
    const existing = this.nodes.find(
      (n) =>
        n.assemblyRunId === input.assemblyRunId &&
        n.nodeId === input.nodeId &&
        n.iteration === input.iteration,
    );

    // Converged duplicate returns the existing station run id — minting a fresh one would give the same pod two names.
    if (existing) {
      return {
        nodeRowId: existing.id,
        stationRunId: existing.stationRunId,
        created: false,
      };
    }
    const nodeRowId = await this.recordNodeStart(input);
    const created = this.nodes.find((n) => n.id === nodeRowId);

    enforceTrue(created, Error, `station run row "${nodeRowId}" vanished`);

    return { nodeRowId, stationRunId: created.stationRunId, created: true };
  }

  async enqueueStationRunDispatch(
    nodeRowId: string,
    dispatchSpec: unknown,
  ): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeRowId);

    // "queued" as well as open (mirrors Pg WHERE) — a claimed row already has its spec; re-arming it would describe a different pod than the one being built.
    if (node && node.outcome === null && node.status === "queued") {
      this.dispatchSpecs.set(nodeRowId, dispatchSpec);
    }
  }

  async claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null> {
    const next = this.nodes.find(
      (n) =>
        n.status === "queued" &&
        n.outcome === null &&
        this.dispatchSpecs.has(n.id) &&
        (n.requiredTags ?? []).every((tag) => claimant.tags.includes(tag)),
    );

    if (!next) {
      return null;
    }
    next.status = "claimed";
    next.clusterAgentId = claimant.clusterAgentId;
    next.claimedAt = this.clock();

    return {
      nodeRowId: next.id,
      stationRunId: next.stationRunId,
      assemblyRunId: next.assemblyRunId,
      nodeId: next.nodeId,
      iteration: next.iteration,
      agentCrName: next.agentCrName,
      dispatchSpec: this.dispatchSpecs.get(next.id) ?? null,
    };
  }

  async requeueStationRun(nodeRowId: string): Promise<boolean> {
    const node = this.nodes.find((n) => n.id === nodeRowId);

    if (!node || node.outcome !== null) {
      return false;
    }
    node.status = "queued";
    node.clusterAgentId = null;
    node.claimedAt = null;
    // Queue clock restarts with the visit (mirrors Pg) — the reaper bounds a queued visit by startedAt, so keeping the original enqueue would fail it as never-claimed.
    node.startedAt = this.clock();

    return true;
  }

  async finishStationRunOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): Promise<boolean> {
    const node = this.nodes.find((n) => n.id === nodeRowId);

    if (!node || node.outcome !== null) {
      return false;
    }

    await this.recordNodeFinish(nodeRowId, outcome, commitSha, failure);

    return true;
  }

  async countOpenClaimsByAgent(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (const n of this.nodes) {
      if (n.outcome === null && (n.clusterAgentId ?? null) !== null) {
        counts[n.clusterAgentId as string] =
          (counts[n.clusterAgentId as string] ?? 0) + 1;
      }
    }

    return counts;
  }

  async listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]> {
    // Numeric-string ids (mints "1","2",… like Pg's BIGINT) — compare with numeric collation; plain Number() would NaN on a non-numeric id and no-op the sort.
    return this.nodes
      .filter((n) => n.assemblyRunId === assemblyRunId)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((n) => ({
        ...n,
        status: n.status ?? "running",
        clusterAgentId: n.clusterAgentId ?? null,
        requiredTags: n.requiredTags ?? [],
        claimedAt: n.claimedAt ?? null,
      }));
  }

  async list(query: AssemblyRunQuery): Promise<AssemblyRunRecord[]> {
    const blueprints =
      query.blueprintName === undefined
        ? null
        : new Set(
            typeof query.blueprintName === "string"
              ? [query.blueprintName]
              : query.blueprintName,
          );
    const statuses = query.status ? new Set(query.status) : null;

    return (
      this.rows
        .filter(
          (row) =>
            (query.repo === undefined || row.repo === query.repo) &&
            (blueprints === null || blueprints.has(row.blueprintName)) &&
            (statuses === null || statuses.has(row.status)) &&
            (query.taskId === undefined || row.taskId === query.taskId) &&
            (query.prNumber === undefined ||
              Number(row.args.pr_number) === query.prNumber) &&
            (query.createdAfter === undefined ||
              row.createdAt >= query.createdAfter) &&
            (query.subjectKey === undefined ||
              row.subjectKey === query.subjectKey) &&
            (query.clusterAgentId === undefined ||
              this.nodes.some(
                (node) =>
                  node.assemblyRunId === row.id &&
                  node.clusterAgentId === query.clusterAgentId &&
                  node.outcome === null,
              )),
        )
        // Newest first, id tiebreak for stability (not chronology) — same-millisecond runs come back in a fixed but arbitrary order, as in Postgres.
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .slice(0, query.limit ?? 50)
    );
  }

  async listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    // Same selection, graph dropped — the double must answer the narrower shape like Postgres, or tests would see a clone the deployed read never ships.
    return (await this.list(query)).map(
      ({ graph: _graph, ...summary }) => summary,
    );
  }

  async listOpen(): Promise<AssemblyRunRecord[]> {
    return this.rows
      .filter((r) => r.status === "queued" || r.status === "running")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findOpenOnBranch(
    repo: string,
    branch: string,
  ): Promise<OpenRunSummary[]> {
    return (await this.listOpen())
      .filter((r) => r.repo === repo && r.branch === branch)
      .map(toOpenSummary);
  }

  async findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<OpenRunSummary | null> {
    const open = (await this.listOpen()).find(
      (r) => r.repo === repo && r.subjectKey === subjectKey,
    );

    return open ? toOpenSummary(open) : null;
  }

  async countBySubject(repo: string, subjectKey: string): Promise<number> {
    return this.rows.filter(
      (r) => r.repo === repo && r.subjectKey === subjectKey,
    ).length;
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

  async listForTask(taskId: string): Promise<AssemblyRunRecord[]> {
    return this.rows
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findOpenByPr(
    repo: string,
    prNumber: number,
  ): Promise<AssemblyRunRecord[]> {
    return this.rows
      .filter((r) => this.matchesOpenPr(r, repo, prNumber))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<ClosedRunRef[]> {
    const open = this.rows.filter(
      (r) =>
        this.matchesOpenPr(r, repo, prNumber) &&
        (!definitions || definitions.includes(r.blueprintName)),
    );

    for (const row of open) {
      row.status = "finished";
      row.outcome = outcome;
      row.finishedAt = this.clock();
    }

    return open.map((row) => ({ id: row.id, taskId: row.taskId ?? null }));
  }

  async hasReviewedPr(repo: string, prNumber: number): Promise<boolean> {
    return this.rows.some(
      (r) =>
        r.repo === repo &&
        r.blueprintName === "code-review" &&
        Number(r.args.pr_number) === prNumber,
    );
  }

  private matchesOpenPr(
    row: AssemblyRunRecord,
    repo: string,
    prNumber: number,
  ): boolean {
    return (
      row.repo === repo &&
      Number(row.args.pr_number) === prNumber &&
      (row.status === "queued" || row.status === "running")
    );
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
      graph: null,
      status: "queued",
      outcome: null,
      reason: null,
      blueprintHash: null,
      resumedFromRunId: input.resumeFrom?.lineId ?? null,
      resumedFromNodeId: input.resumeFrom?.nodeId ?? null,
      inheritedNodeCount: 0,
      createdAt: this.clock(),
      startedAt: null,
      finishedAt: null,
    };
  }

  private mustFind(id: string): AssemblyRunRecord {
    const row = this.rows.find((r) => r.id === id);

    enforceTrue(row, Error, `no assembly line "${id}"`);

    return row;
  }
}
