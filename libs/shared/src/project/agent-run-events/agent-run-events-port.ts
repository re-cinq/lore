/**
 * The six stream-json line kinds the projector persists. A line of any other
 * kind is dropped by the projector before it reaches this port.
 */
export type AgentRunEventType =
  "init" | "message" | "thinking" | "tool_call" | "tool_result" | "result";

/**
 * One row of `pipeline.agent_run_events` — the canonical per-tool-call agent
 * telemetry contract for the whole run-visualization epic.
 *
 * `id` is a string-encoded bigint and stays a string across every wire
 * boundary: the identity column outgrows `Number.MAX_SAFE_INTEGER`, and it
 * doubles as the SSE `Last-Event-ID` cursor, so narrowing it to a JS number
 * would silently corrupt the stream position.
 *
 * `assemblyLineId`, `nodeId` and `iteration` are nullable: an agent CR
 * dispatched for a plain task rather than an assembly-line node is named from
 * the task id and correlates to no node row.
 */
export interface AgentRunEventRow {
  id: string;
  taskId: string;
  agentCrName: string | null;
  assemblyLineId: string | null;
  nodeId: string | null;
  iteration: number | null;
  eventType: AgentRunEventType;
  toolName: string | null;
  toolUseId: string | null;
  isError: boolean;
  filePaths: string[];
  summary: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * What the projector supplies for one row. The correlated fields
 * (`assemblyLineId`, `nodeId`, `iteration`) are absent by design — the
 * repository resolves them from `agentCrName` at write time — as are `id` and
 * `createdAt`, which the database mints.
 */
export interface AgentRunEventInsert {
  taskId: string;
  agentCrName: string | null;
  eventType: AgentRunEventType;
  toolName?: string | null;
  toolUseId?: string | null;
  isError?: boolean;
  filePaths?: readonly string[];
  summary?: string | null;
  payload?: Record<string, unknown>;
}

/** A node identity the correlation lookup can resolve an `agentCrName` to. */
export interface AgentRunEventNodeRef {
  agentCrName: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
}

/**
 * The per-tool-call agent telemetry surface: the ingest projector writes
 * through `insertBatch`, the SSE endpoint catches up through `listSince`, and
 * the retention cron reaps through `pruneOld`.
 */
export interface AgentRunEventsRepository {
  /**
   * Insert a batch, resolving `agentCrName` to (`assemblyLineId`, `nodeId`,
   * `iteration`) against `pipeline.station_runs` at write time. A row
   * that correlates to nothing is still inserted, with `agentCrName` retained
   * and the three correlated fields left null. Returns the persisted rows
   * ascending by id, so the caller can publish to the SSE bus without a
   * re-read.
   */
  insertBatch(
    rows: readonly AgentRunEventInsert[],
  ): Promise<AgentRunEventRow[]>;
  /** Rows for one line with id > afterId, ascending, capped — the SSE catch-up read. */
  listSince(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunEventRow[]>;
  /** Delete rows older than the horizon; returns the count deleted. */
  pruneOld(olderThanDays: number): Promise<number>;
}
