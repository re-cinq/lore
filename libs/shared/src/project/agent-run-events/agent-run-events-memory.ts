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

/**
 * In-memory {@link AgentRunEventsRepository} — the behavioral spec for the
 * port. It reproduces the Pg adapter's observable contract without Postgres:
 * write-time correlation (last registered node wins, as the adapter's
 * `ORDER BY node.id DESC LIMIT 1` does), string-encoded ids compared
 * numerically, ascending capped reads, and horizon pruning.
 *
 * Seed the correlation table with {@link registerNode}; inject `now` to drive
 * `pruneOld` deterministically.
 */
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
    // The Pg adapter returns id-ascending (`.sort(byIdAscending)`); sorting
    // here too keeps that part of the contract explicit rather than a
    // coincidence of sequential nextId assignment.
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

  private persist(insert: AgentRunEventInsert): AgentRunEventRow {
    // Stated beats inferred, and beats it WHOLE — never one field from each, which
    // would pin the row to a run while guessing which visit produced it.
    const carried = insert.carried ?? undefined;
    const inferred = carried ? undefined : this.correlate(insert.agentCrName);
    const node = carried ?? inferred;
    const row: AgentRunEventRow = {
      id: String(this.nextId++),
      taskId: insert.taskId,
      agentCrName: insert.agentCrName,
      assemblyLineId:
        carried?.assemblyRunId ?? inferred?.assemblyLineId ?? null,
      stationRunId: node?.stationRunId ?? null,
      nodeId: node?.nodeId ?? null,
      iteration: node?.iteration ?? null,
      eventType: insert.eventType,
      toolName: insert.toolName ?? null,
      toolUseId: insert.toolUseId ?? null,
      isError: insert.isError ?? false,
      filePaths: [...(insert.filePaths ?? [])],
      summary: insert.summary ?? null,
      payload: insert.payload ?? {},
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

    // CR names are unique per line (a revisited node's iteration gets its own
    // -<n> suffix), so multiple matches only occur when two DIFFERENT lines
    // collide on their 12-hex id prefix + node id + iteration; the newest node
    // row wins then, mirroring the Pg adapter's `ORDER BY node.id DESC LIMIT 1`.
    const matches = this.nodes.filter(
      (node) => node.agentCrName === agentCrName,
    );

    return matches[matches.length - 1];
  }
}
