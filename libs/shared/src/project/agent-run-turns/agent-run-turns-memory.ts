import type { AgentRunEventNodeRef } from "../agent-run-events/agent-run-events-port.js";
import type {
  AgentRunTurnInsert,
  AgentRunTurnRow,
  AgentRunTurnsRepository,
} from "./agent-run-turns-port.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const byIdAscending = (a: AgentRunTurnRow, b: AgentRunTurnRow): number =>
  BigInt(a.id) < BigInt(b.id) ? -1 : 1;

/**
 * In-memory {@link AgentRunTurnsRepository} — the behavioral spec for the Pg
 * adapter, mirroring `InMemoryAgentRunEvents`: write-time correlation (last
 * registered node wins), string-encoded ids, ascending capped reads, horizon
 * pruning. Seed correlation with {@link registerNode}; inject `now` for
 * deterministic pruning.
 */
export class InMemoryAgentRunTurns implements AgentRunTurnsRepository {
  readonly rows: AgentRunTurnRow[] = [];
  private readonly nodes: AgentRunEventNodeRef[] = [];
  private readonly now: () => Date;
  private nextId = 1;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  registerNode(node: AgentRunEventNodeRef): void {
    this.nodes.push(node);
  }

  async insertBatch(rows: readonly AgentRunTurnInsert[]): Promise<number> {
    for (const insert of rows) {
      const node = this.correlate(insert.agentCrName);

      this.rows.push({
        id: String(this.nextId++),
        taskId: insert.taskId,
        agentCrName: insert.agentCrName,
        assemblyLineId: node?.assemblyLineId ?? null,
        nodeId: node?.nodeId ?? null,
        iteration: node?.iteration ?? null,
        eventType: insert.eventType,
        payload: insert.payload,
        createdAt: this.now(),
      });
    }

    return rows.length;
  }

  async listForAssemblyLine(
    assemblyLineId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    return this.rows
      .filter((row) => row.assemblyLineId === assemblyLineId)
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

  private correlate(
    agentCrName: string | null,
  ): AgentRunEventNodeRef | undefined {
    if (agentCrName === null) {
      return undefined;
    }
    const matches = this.nodes.filter(
      (node) => node.agentCrName === agentCrName,
    );

    return matches[matches.length - 1];
  }
}
