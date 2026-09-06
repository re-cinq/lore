import type { CarriedRunIdentity } from "../run-identity/carried-run-identity.js";
import type {
  AgentRunEventInsert,
  AgentRunEventNodeRef,
  AgentRunEventRow,
  AgentRunEventsRepository,
} from "./agent-run-events-port.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const byIdAscending = (a: AgentRunEventRow, b: AgentRunEventRow): number => {
  const left = BigInt(a.id);
  const right = BigInt(b.id);

  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
};

interface ResolvedNodeIdentity {
  assemblyLineId: string | null;
  stationRunId: string | null;
  nodeId: string | null;
  iteration: number | null;
}

const emptyNodeIdentity: ResolvedNodeIdentity = {
  assemblyLineId: null,
  stationRunId: null,
  nodeId: null,
  iteration: null,
};

const nodeIdentityFromCarried = (
  carried: CarriedRunIdentity,
): ResolvedNodeIdentity => ({
  assemblyLineId: carried.assemblyRunId,
  stationRunId: carried.stationRunId,
  nodeId: carried.nodeId,
  iteration: carried.iteration,
});

const nodeIdentityFromRef = (
  node: AgentRunEventNodeRef | undefined,
): ResolvedNodeIdentity => {
  if (!node) {
    return emptyNodeIdentity;
  }

  return {
    assemblyLineId: node.assemblyLineId,
    stationRunId: node.stationRunId ?? null,
    nodeId: node.nodeId,
    iteration: node.iteration,
  };
};

interface NormalizedToolDefaults {
  toolName: string | null;
  toolUseId: string | null;
}

const normalizeToolDefaults = (
  insert: AgentRunEventInsert,
): NormalizedToolDefaults => ({
  toolName: insert.toolName ?? null,
  toolUseId: insert.toolUseId ?? null,
});

interface NormalizedEventDefaults {
  isError: boolean;
  filePaths: string[];
  summary: string | null;
  payload: Record<string, unknown>;
}

const normalizeEventDefaults = (
  insert: AgentRunEventInsert,
): NormalizedEventDefaults => ({
  isError: insert.isError ?? false,
  filePaths: [...(insert.filePaths ?? [])],
  summary: insert.summary ?? null,
  payload: insert.payload ?? {},
});

/** In-memory {@link AgentRunEventsRepository} with Pg-equivalent contract: write-time correlation (last node wins), ascending id capped reads, horizon pruning. Seed with registerNode; inject now for deterministic pruneOld. */
export class InMemoryAgentRunEvents implements AgentRunEventsRepository {
  readonly rows: AgentRunEventRow[] = [];
  private readonly nodes: AgentRunEventNodeRef[] = [];
  private readonly now: () => Date;
  private nextId = 1;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  registerNode(node: AgentRunEventNodeRef): void {
    this.nodes.push(node);
  }

  async insertBatch(
    rows: readonly AgentRunEventInsert[],
  ): Promise<AgentRunEventRow[]> {
    // Sort to keep id-ascending contract explicit, not sequential-assignment coincidence.
    return rows.map((row) => this.persist(row)).sort(byIdAscending);
  }

  async listSince(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunEventRow[]> {
    const cursor = BigInt(afterId);

    return this.rows
      .filter(
        (row) =>
          row.assemblyLineId === assemblyLineId && BigInt(row.id) > cursor,
      )
      .sort(byIdAscending)
      .slice(0, limit);
  }

  async pruneOld(olderThanDays: number): Promise<number> {
    const horizon = this.now().getTime() - olderThanDays * MS_PER_DAY;
    const kept = this.rows.filter((row) => row.createdAt.getTime() >= horizon);
    const deleted = this.rows.length - kept.length;

    this.rows.splice(0, this.rows.length, ...kept);

    return deleted;
  }

  // Stated beats inferred WHOLE — never one field from each.
  private persist(insert: AgentRunEventInsert): AgentRunEventRow {
    const identity = insert.carried
      ? nodeIdentityFromCarried(insert.carried)
      : nodeIdentityFromRef(this.correlate(insert.agentCrName));
    const row: AgentRunEventRow = {
      id: String(this.nextId++),
      taskId: insert.taskId,
      agentCrName: insert.agentCrName,
      eventType: insert.eventType,
      ...identity,
      ...normalizeToolDefaults(insert),
      ...normalizeEventDefaults(insert),
      createdAt: this.now(),
    };

    this.rows.push(row);

    return row;
  }

  private correlate(
    agentCrName: string | null,
  ): AgentRunEventNodeRef | undefined {
    if (agentCrName === null) {
      return undefined;
    }

    // CR names unique per line; multiple matches only on collisions of 12-hex prefix + node id + iteration; newest node wins (mirrors Pg ORDER BY node.id DESC LIMIT 1).
    const matches = this.nodes.filter(
      (node) => node.agentCrName === agentCrName,
    );

    return matches[matches.length - 1];
  }
}
