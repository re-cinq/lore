/**
 * One row of `pipeline.agent_run_turns` — the full-fidelity turn-level
 * transcript store (specs/turn-level-transcript-store), sibling to the
 * deliberately truncated `agent_run_events` projection.
 *
 * `id` is a string-encoded bigint and stays a string across every wire
 * boundary: the identity column outgrows `Number.MAX_SAFE_INTEGER` and doubles
 * as the read cursor, so narrowing it to a JS number would silently corrupt
 * the read position.
 *
 * Every correlation field is nullable. A line the agent subsystem attributed
 * to no task, or whose CR name matches no node row, is still stored — a store
 * whose whole point is fidelity must not drop the lines it cannot label.
 */
export interface AgentRunTurnRow {
  id: string;
  taskId: string | null;
  agentCrName: string | null;
  assemblyLineId: string | null;
  nodeId: string | null;
  iteration: number | null;
  /** The raw stream-json line kind, as emitted; not narrowed to a union, so a
   *  kind this Floor has never seen is still stored under its own name. */
  eventType: string | null;
  /** The untruncated `{source, event}` line. */
  envelope: Record<string, unknown>;
  createdAt: Date;
}

/**
 * What the ingest tee supplies for one turn. The correlated fields
 * (`assemblyLineId`, `nodeId`, `iteration`) are absent by design — the
 * repository resolves them from `agentCrName` at write time — as are `id` and
 * `createdAt`, which the database mints.
 */
export interface AgentRunTurnInsert {
  taskId: string | null;
  agentCrName: string | null;
  eventType: string | null;
  /**
   * The envelope as JSON **text**, not as a parsed object: the ingest path
   * already holds the raw NDJSON line as a string, and handing that string
   * straight through means the hot path neither re-parses nor re-serializes a
   * payload it is already carrying. The adapter casts it to `jsonb` in the
   * statement; readers get it back parsed.
   */
  envelope: string;
}

/** A node identity the correlation lookup can resolve an `agentCrName` to. */
export interface AgentRunTurnNodeRef {
  agentCrName: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
}

/**
 * The turn-level transcript surface: the ingest tee writes through
 * `insertBatch`, post-mortems page through `listByLine` / `listByTask`, and
 * the retention cron reaps through `pruneOld`.
 */
export interface AgentRunTurnsRepository {
  /**
   * Insert a batch, resolving `agentCrName` to (`assemblyLineId`, `nodeId`,
   * `iteration`) against `pipeline.assembly_line_nodes` at write time. A turn
   * that correlates to nothing is still inserted, with `agentCrName` retained
   * and the three correlated fields left null. Returns the persisted rows
   * ascending by id.
   */
  insertBatch(rows: readonly AgentRunTurnInsert[]): Promise<AgentRunTurnRow[]>;
  /** One assembly line's turns with id > afterId, ascending, capped. */
  listByLine(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]>;
  /** One task's turns with id > afterId, ascending, capped — the only path to
   *  rows that correlate to no assembly-line node. */
  listByTask(
    taskId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]>;
  /** Delete turns older than the horizon; returns the count deleted. */
  pruneOld(olderThanDays: number): Promise<number>;
}
