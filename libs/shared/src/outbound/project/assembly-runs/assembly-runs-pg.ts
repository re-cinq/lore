import type { RunGraph } from "./run-graph.js";
import type { AssemblyRunQuery } from "./assembly-runs-port.js";
import type { PgPool } from "../../memory-store.js";
import type {
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
import * as lifecycle from "./assembly-runs-pg-lifecycle.js";
import * as stationRuns from "./assembly-runs-pg-station-runs.js";
import * as queries from "./assembly-runs-pg-queries.js";

// Postgres-backed AssemblyRunsPort (migration 0025); every method delegates onto a pure-pool function grouped by job across the sibling assembly-runs-pg-{rows,lifecycle,station-runs,queries}.ts modules.
export class PgAssemblyRuns implements AssemblyRunsPort {
  constructor(private readonly pool: PgPool) {}

  async start(input: AssemblyRunStartInput): Promise<string> {
    return lifecycle.start(this.pool, input);
  }

  async markRunning(id: string): Promise<void> {
    return lifecycle.markRunning(this.pool, id);
  }

  async stampBlueprint(
    id: string,
    hash: string,
    graph?: RunGraph,
  ): Promise<void> {
    return lifecycle.stampBlueprint(this.pool, id, hash, graph);
  }

  async finish(id: string, outcome: string, reason?: string): Promise<boolean> {
    return lifecycle.finish(this.pool, id, outcome, reason);
  }

  async ensureStationRun(
    input: StationRunStartInput,
  ): Promise<{ nodeRowId: string; stationRunId: string; created: boolean }> {
    return stationRuns.ensureStationRun(this.pool, input);
  }

  async finishStationRunOnce(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): Promise<boolean> {
    return stationRuns.finishStationRunOnce(this.pool, nodeRowId, outcome, {
      commitSha,
      failure,
    });
  }

  async enqueueStationRunDispatch(
    nodeRowId: string,
    dispatchSpec: unknown,
  ): Promise<void> {
    return stationRuns.enqueueStationRunDispatch(
      this.pool,
      nodeRowId,
      dispatchSpec,
    );
  }

  async claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null> {
    return stationRuns.claimNextStationRun(this.pool, claimant);
  }

  async requeueStationRun(nodeRowId: string): Promise<boolean> {
    return stationRuns.requeueStationRun(this.pool, nodeRowId);
  }

  async countOpenClaimsByAgent(): Promise<Record<string, number>> {
    return stationRuns.countOpenClaimsByAgent(this.pool);
  }

  async listStationRuns(assemblyRunId: string): Promise<StationRunRecord[]> {
    return stationRuns.listStationRuns(this.pool, assemblyRunId);
  }

  async listOpen(): Promise<AssemblyRunRecord[]> {
    return queries.listOpen(this.pool);
  }

  async findOpenOnBranch(
    repo: string,
    branch: string,
  ): Promise<OpenRunSummary[]> {
    return queries.findOpenOnBranch(this.pool, repo, branch);
  }

  async findOpenBySubject(
    repo: string,
    subjectKey: string,
  ): Promise<OpenRunSummary | null> {
    return queries.findOpenBySubject(this.pool, repo, subjectKey);
  }

  async countBySubject(repo: string, subjectKey: string): Promise<number> {
    return queries.countBySubject(this.pool, repo, subjectKey);
  }

  async mergeArgs(id: string, patch: Record<string, unknown>): Promise<void> {
    return queries.mergeArgs(this.pool, id, patch);
  }

  async getById(id: string): Promise<AssemblyRunRecord | null> {
    return queries.getById(this.pool, id);
  }

  async list(query: AssemblyRunQuery): Promise<AssemblyRunRecord[]> {
    return queries.list(this.pool, query);
  }

  async listSummaries(query: AssemblyRunQuery): Promise<AssemblyRunSummary[]> {
    return queries.listSummaries(this.pool, query);
  }

  async listForTask(taskId: string): Promise<AssemblyRunRecord[]> {
    return queries.listForTask(this.pool, taskId);
  }

  async findOpenByPr(
    repo: string,
    prNumber: number,
  ): Promise<AssemblyRunRecord[]> {
    return queries.findOpenByPr(this.pool, repo, prNumber);
  }

  async finishOpenByPr(
    repo: string,
    prNumber: number,
    outcome: string,
    definitions?: readonly string[],
  ): Promise<ClosedRunRef[]> {
    return queries.finishOpenByPr(this.pool, repo, prNumber, {
      outcome,
      definitions,
    });
  }

  async hasReviewedPr(repo: string, prNumber: number): Promise<boolean> {
    return queries.hasReviewedPr(this.pool, repo, prNumber);
  }
}
