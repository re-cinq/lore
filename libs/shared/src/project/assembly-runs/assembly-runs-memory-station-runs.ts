import type { StationRunInput } from "../../models/station-run.js";
import { enforceTrue } from "../../lib/enforce.js";
import { randomUUID } from "node:crypto";
import type {
  StationRunFailure,
  StationRunStartInput,
  ClaimedStationRun,
  StationRunRecord,
} from "./assembly-runs-port.js";

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

/** Marks one open node row stranded by its run finishing without it — a visit that DID report keeps its own outcome (the `??` fallbacks only fill what's still unset). */
function strandNode(node: SeedAssemblyLineNode, now: Date): void {
  node.finishedAt = now;
  node.outcome = node.outcome ?? "failed";
  node.failureClass = node.failureClass ?? "unknown";
  node.failureDetail =
    node.failureDetail ??
    "the run finished while this visit was still open — the visit never reported an outcome";
}

/** In-memory station-run (node-level) rows for one InMemoryAssemblyRuns instance — the "which pod ran which node, claimed by which cluster" half of the double, split out from the assembly-run (line-level) half. */
export class StationRunStore {
  nodes: SeedAssemblyLineNode[] = [];
  private readonly dispatchSpecs = new Map<string, unknown>();

  constructor(private readonly clock: () => Date) {}

  /** Copies a fork's inherited node rows into THIS run's own identity space (own station_run_id, no source CR name / verdict — see inline notes below). */
  seedInheritedNodes(
    inherited: StationRunRecord[],
    assemblyRunId: string,
  ): void {
    for (const node of inherited) {
      this.nodes.push({
        ...node,
        id: String(this.nodes.length + 1),
        // Copied row is of THIS run, so it gets its own identity — sharing a station_run_id would merge telemetry.
        stationRunId: randomUUID(),
        assemblyRunId,
        // Copied rows never carry the source's CR name — run-viz/cost joins resolve by newest node row, so an echoed name would steal late-arriving source rows.
        agentCrName: null,
        // Nor its verdict — getNextTransition replays the copied prefix and would fail the fork on an inherited permanent-failure visit on first advance.
        failureClass: null,
        failureDetail: null,
      });
    }
  }

  /** A visit still open under a finishing run is stranded: the reaper sweeps only OPEN runs, so nothing would ever close it, and the spend page bills an unfinished visit at its cap. A visit that DID report keeps its own outcome. */
  strandOpenNodes(assemblyRunId: string): void {
    const now = this.clock();

    for (const node of this.nodes) {
      if (node.assemblyRunId === assemblyRunId && node.finishedAt === null) {
        strandNode(node, now);
      }
    }
  }

  private recordNodeStart(input: StationRunStartInput): string {
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

  private recordNodeFinish(
    nodeRowId: string,
    outcome: string,
    commitSha?: string,
    failure?: StationRunFailure,
  ): void {
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
    const nodeRowId = this.recordNodeStart(input);
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

    this.recordNodeFinish(nodeRowId, outcome, commitSha, failure);

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

  hasOpenClaimByAgent(runId: string, clusterAgentId: string): boolean {
    return this.nodes.some(
      (node) =>
        node.assemblyRunId === runId &&
        node.clusterAgentId === clusterAgentId &&
        node.outcome === null,
    );
  }
}
