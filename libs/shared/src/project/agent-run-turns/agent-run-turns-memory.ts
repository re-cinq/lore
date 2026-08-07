import {
  compareTurnIdAscending,
  type AgentRunTurnInsert,
  type AgentRunTurnNodeRef,
  type AgentRunTurnRow,
  type AgentRunTurnsRepository,
} from "./agent-run-turns-port.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * In-memory {@link AgentRunTurnsRepository} — the behavioral spec for the
 * port. It reproduces the Pg adapter's observable contract without Postgres:
 * write-time correlation (newest registered node wins, as the adapter's
 * `ORDER BY node.id DESC LIMIT 1` does), string-encoded ids compared
 * numerically, ascending capped reads, and horizon pruning. The envelope
 * arrives as JSON text and comes back parsed, exactly as `jsonb` does.
 *
 * Seed the correlation table with {@link registerNode}; inject `now` to drive
 * `pruneOld` deterministically.
 */
export class InMemoryAgentRunTurns implements AgentRunTurnsRepository {
  readonly rows: AgentRunTurnRow[] = [];
  private readonly nodes: AgentRunTurnNodeRef[] = [];
  private readonly now: () => Date;
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
    return rows.map((row) => this.persist(row)).sort(compareTurnIdAscending);
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
    const node = this.correlate(insert.agentCrName);
    const row: AgentRunTurnRow = {
      id: String(this.nextId++),
      taskId: insert.taskId,
      agentCrName: insert.agentCrName,
      assemblyLineId: node?.assemblyLineId ?? null,
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
