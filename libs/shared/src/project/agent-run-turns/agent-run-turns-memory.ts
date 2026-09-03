import {
  compareTurnIdAscending,
  type AgentRunTurnInsert,
  type AgentRunTurnNodeRef,
  type AgentRunTurnRow,
  type AgentRunTurnsRepository,
} from "./agent-run-turns-port.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** In-memory {@link AgentRunTurnsRepository} with Pg-equivalent contract: write-time correlation (newest node wins), ascending id capped reads, horizon pruning, envelope JSON roundtrip. Non-null dedupKey already stored skips row (#1389). Seed with registerNode; inject now for deterministic pruneOld. */
export class InMemoryAgentRunTurns implements AgentRunTurnsRepository {
  readonly rows: AgentRunTurnRow[] = [];
  private readonly nodes: AgentRunTurnNodeRef[] = [];
  private readonly now: () => Date;
  private readonly rowIdByDedupKey = new Map<string, string>();
  private nextId = 1;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  registerNode(node: AgentRunTurnNodeRef): void {
    this.nodes.push(node);
  }

  async insertBatch(
    rows: readonly AgentRunTurnInsert[],
  ): Promise<AgentRunTurnRow[]> {
    const inserted: AgentRunTurnRow[] = [];

    for (const row of rows) {
      if (row.dedupKey != null && this.rowIdByDedupKey.has(row.dedupKey)) {
        continue;
      }
      const persisted = this.persist(row);

      if (row.dedupKey != null) {
        this.rowIdByDedupKey.set(row.dedupKey, persisted.id);
      }
      inserted.push(persisted);
    }

    return inserted.sort(compareTurnIdAscending);
  }

  async listByLine(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    return this.page(
      (row) => row.assemblyLineId === assemblyLineId,
      afterId,
      limit,
    );
  }

  async listByTask(
    taskId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    return this.page((row) => row.taskId === taskId, afterId, limit);
  }

  async pruneOld(olderThanDays: number): Promise<number> {
    const horizon = this.now().getTime() - olderThanDays * MS_PER_DAY;
    const kept = this.rows.filter((row) => row.createdAt.getTime() >= horizon);
    const deleted = this.rows.length - kept.length;

    this.rows.splice(0, this.rows.length, ...kept);
    const keptIds = new Set(kept.map((row) => row.id));

    for (const [key, rowId] of this.rowIdByDedupKey) {
      if (!keptIds.has(rowId)) {
        this.rowIdByDedupKey.delete(key);
      }
    }

    return deleted;
  }

  private page(
    scope: (row: AgentRunTurnRow) => boolean,
    afterId: string,
    limit: number,
  ): AgentRunTurnRow[] {
    const cursor = BigInt(afterId);

    return this.rows
      .filter((row) => scope(row) && BigInt(row.id) > cursor)
      .sort(compareTurnIdAscending)
      .slice(0, limit);
  }

  private persist(insert: AgentRunTurnInsert): AgentRunTurnRow {
    // Stated beats inferred, whole — see agent-run-events-memory.
    const carried = insert.carried ?? undefined;
    const inferred = carried ? undefined : this.correlate(insert.agentCrName);
    const node = carried ?? inferred;
    const row: AgentRunTurnRow = {
      id: String(this.nextId++),
      taskId: insert.taskId,
      agentCrName: insert.agentCrName,
      assemblyLineId:
        carried?.assemblyRunId ?? inferred?.assemblyLineId ?? null,
      stationRunId: node?.stationRunId ?? null,
      nodeId: node?.nodeId ?? null,
      iteration: node?.iteration ?? null,
      eventType: insert.eventType,
      envelope: JSON.parse(insert.envelope) as Record<string, unknown>,
      createdAt: this.now(),
    };

    this.rows.push(row);

    return row;
  }

  private correlate(
    agentCrName: string | null,
  ): AgentRunTurnNodeRef | undefined {
    if (agentCrName === null) {
      return undefined;
    }
    const matches = this.nodes.filter(
      (node) => node.agentCrName === agentCrName,
    );

    return matches[matches.length - 1];
  }
}
