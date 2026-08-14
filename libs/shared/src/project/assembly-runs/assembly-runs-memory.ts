import { enforceTrue } from "../../lib/enforce.js";
import { randomUUID } from "node:crypto";
import { resolveResumePrefix } from "./resume.js";
import { RUN_START_EVENT } from "./run-events.js";
import type { RunGraph } from "./run-graph.js";
import type {
  AssemblyRunQuery,
  AssemblyRunsPort,
  AssemblyRunStartInput,
  StationRunStartInput,
  AssemblyRunRecord,
  StationRunRecord,
  OpenRunSummary,
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
  outcome: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A fork inherits branch and taskId from its source and its args unless the
 *  caller overrides them; a plain start is passed through untouched. */
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
    args: input.args ?? source.args,
  };
}

/**
 * In-memory {@link AssemblyRunsPort}: the behavioral spec of the Pg adapter,
 * computed over seeded rows. `clock` is injectable so ordering-dependent reads
 * are deterministic in tests.
 */
export class InMemoryAssemblyRuns implements AssemblyRunsPort {
  rows: AssemblyRunRecord[] = [];
  nodes: SeedAssemblyLineNode[] = [];
  events: SeedAssemblyLineEvent[] = [];

  constructor(public clock: () => Date = () => new Date()) {}

  async start(input: AssemblyRunStartInput): Promise<string> {
    const resumeFrom = input.resumeFrom;
    const source = resumeFrom ? await this.getById(resumeFrom.lineId) : null;
    // Validate the fork BEFORE minting anything, so a rejected resume leaves no
    // half-created line behind (the Pg adapter gets the same property from its
    // read-then-one-CTE shape).
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
    // A fork carries its source's hash; a plain start carries none until the
    // Floor stamps it — `input.blueprintHash` is a resume INPUT, and the Pg
    // plain-start CTE likewise never writes it.
    row.blueprintHash = source?.blueprintHash ?? null;
    // A fork replays its source's rows, so it MUST walk the same graph — the
    // hash guard already proved the current blueprint still matches it.
    row.graph = source?.graph ?? null;
    this.rows.push(row);

    for (const node of inherited) {
      this.nodes.push({
        ...node,
        id: String(this.nodes.length + 1),
        // A copied row is a row of THIS run, so it gets its own identity — two
        // runs sharing a station_run_id would merge their telemetry.
        stationRunId: randomUUID(),
        assemblyRunId: id,
        // Copied rows never carry the source's CR name: the run-viz and cost
        // correlation joins resolve agent_cr_name -> newest node row, and an
        // echoed name would steal the source's late-arriving rows.
        agentCrName: null,
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

    // Write-once, guarded on the HASH for both fields (mirrors the Pg WHERE):
    // the pair describes one blueprint, so stamping them independently could
    // leave a row whose graph and hash came from different loads.
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

    return true;
  }

  private async recordNodeStart(input: StationRunStartInput): Promise<string> {
    const id = String(this.nodes.length + 1);

    this.nodes.push({
      id,
      stationRunId: randomUUID(),
      assemblyRunId: input.assemblyRunId,
      nodeId: input.nodeId,
      iteration: input.iteration,
      agentCrName: input.agentCrName ?? null,
      outcome: null,
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
  ): Promise<void> {
    const node = this.nodes.find((n) => n.id === nodeRowId);

    enforceTrue(node, Error, `no assembly line node row "${nodeRowId}"`);
    node.outcome = outcome;
    node.commitSha = commitSha ?? null;
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

    // A converged duplicate returns the EXISTING station run id: the id names the
    // visit, and minting a fresh one per call would give the same pod two names.
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

  async finishStationRunOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
  ): Promise<boolean> {
    const node = this.nodes.find((n) => n.id === nodeRowId);

    if (!node || node.outcome !== null) {
      return false;
    }

    await this.recordNodeFinish(nodeRowId, outcome, commitSha);

    return true;
  }

  async listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]> {
    // Numeric-string ids (this double mints "1","2",…; Pg's BIGINT identity is
    // likewise numeric) — compare with numeric collation so the double stays
    // honest as the behavioral spec (a plain Number() diff would NaN on any
    // non-numeric id and silently no-op the sort).
    return this.nodes
      .filter((n) => n.assemblyRunId === assemblyRunId)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
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
              row.createdAt >= query.createdAfter),
        )
        // Newest first, id as the tiebreak. The tiebreak buys STABILITY, not
        // insertion order — run ids are random uuids, so two runs created in the
        // same millisecond come back in a fixed but arbitrary order here and in
        // Postgres alike. Callers that need chronology must not create ties.
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        )
        .slice(0, query.limit ?? 50)
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
      .map((r) => ({
        id: r.id,
        status: r.status as "queued" | "running",
        repo: r.repo,
        branch: r.branch,
        createdAt: r.createdAt,
      }));
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
  ): Promise<number> {
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

    return open.length;
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
