import type { StationRunInput } from "../../../domain/models/station-run.js";
import { enforceTrue } from "../../../lib/enforce.js";
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

function newNodeRow(
  id: string,
  input: StationRunStartInput,
  startedAt: Date,
): SeedAssemblyLineNode {
  return {
    id,
    stationRunId: randomUUID(),
    assemblyRunId: input.assemblyRunId,
    nodeId: input.nodeId,
    iteration: input.iteration,
    agentCrName: input.agentCrName ?? null,
    input: input.input ?? null,
    status: input.status ?? "running",
    requiredTags: input.requiredTags ?? [],
    ...emptyNodeOutcome(startedAt),
  };
}

/** The columns a fresh node row starts empty: it has been created, not run. */
function emptyNodeOutcome(startedAt: Date) {
  return {
    clusterAgentId: null,
    claimedAt: null,
    outcome: null,
    failureClass: null,
    failureDetail: null,
    commitSha: null,
    startedAt,
    finishedAt: null,
  };
}

/** The same visit: one node row is identified by its run, node and iteration — the double's stand-in for the Pg unique key. */
function isSameVisit(
  node: SeedAssemblyLineNode,
  input: StationRunStartInput,
): boolean {
  return (
    node.assemblyRunId === input.assemblyRunId &&
    node.nodeId === input.nodeId &&
    node.iteration === input.iteration
  );
}

function toClaimed(
  node: SeedAssemblyLineNode,
  dispatchSpec: unknown,
): ClaimedStationRun {
  return {
    nodeRowId: node.id,
    stationRunId: node.stationRunId,
    assemblyRunId: node.assemblyRunId,
    nodeId: node.nodeId,
    iteration: node.iteration,
    agentCrName: node.agentCrName,
    dispatchSpec,
  };
}

/** A seed row in the port's spelling: pre-flip seeds omit the claim columns, so they read with the push-era defaults (running, no claim, no tags). */
function toStationRun(node: SeedAssemblyLineNode): StationRunRecord {
  return {
    ...node,
    status: node.status ?? "running",
    clusterAgentId: node.clusterAgentId ?? null,
    requiredTags: node.requiredTags ?? [],
    claimedAt: node.claimedAt ?? null,
  };
}

/** In-memory station-run (node-level) rows for one InMemoryAssemblyRuns instance — the "which pod ran which node, claimed by which cluster" half of the double, split out from the assembly-run (line-level) half. */
export class StationRunStore {
  readonly nodes: SeedAssemblyLineNode[] = [];
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
    this.nodes.push(newNodeRow(id, input, this.clock()));

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
    // Converged duplicate returns the existing station run id — minting a fresh one would give the same pod two names.
    const existing = this.nodes.find((n) => isSameVisit(n, input));

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

  /** The first row a cluster agent with these tags may take: queued, unfinished, armed with a dispatch spec, and tag-compatible. */
  private nextClaimable(tags: string[]): SeedAssemblyLineNode | undefined {
    return this.nodes.find(
      (n) =>
        n.status === "queued" &&
        n.outcome === null &&
        this.dispatchSpecs.has(n.id) &&
        (n.requiredTags ?? []).every((tag) => tags.includes(tag)),
    );
  }

  async claimNextStationRun(claimant: {
    clusterAgentId: string;
    tags: string[];
  }): Promise<ClaimedStationRun | null> {
    const next = this.nextClaimable(claimant.tags);

    if (!next) {
      return null;
    }
    next.status = "claimed";
    next.clusterAgentId = claimant.clusterAgentId;
    next.claimedAt = this.clock();

    return toClaimed(next, this.dispatchSpecs.get(next.id) ?? null);
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
      .map(toStationRun);
  }

  async findStationRunByAgentCrName(
    agentCrName: string,
  ): Promise<StationRunRecord | null> {
    const newest = this.nodes
      .filter((n) => n.agentCrName === agentCrName)
      .at(-1);

    return newest ? toStationRun(newest) : null;
  }

  async findStationRunById(
    stationRunId: string,
  ): Promise<StationRunRecord | null> {
    const visit = this.nodes.find((n) => n.stationRunId === stationRunId);

    return visit ? toStationRun(visit) : null;
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
