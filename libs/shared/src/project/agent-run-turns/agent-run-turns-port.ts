/**
 * `pipeline.agent_run_turns` — the full-fidelity turn store beside the
 * truncated `agent_run_events` projection (specs/turn-level-transcript-store).
 * One row per stream-json line, payload untruncated, same write-time
 * correlation columns as the projection, longer retention (90 days). The
 * projection stays the live view's source; this table answers post-mortems.
 */

import type { AgentRunEventNodeRef } from "../agent-run-events/agent-run-events-port.js";

/** The raw stream-json line kinds a turn row preserves. Unlike the
 *  projection's six per-block kinds, turns keep LINE granularity. */
export type AgentRunTurnType =
  "system" | "assistant" | "user" | "result" | "log";

export interface AgentRunTurnRow {
  /** String-encoded bigint — outgrows `Number.MAX_SAFE_INTEGER`. */
  id: string;
  taskId: string;
  agentCrName: string | null;
  assemblyLineId: string | null;
  nodeId: string | null;
  iteration: number | null;
  eventType: AgentRunTurnType;
  /** The full stream-json line, redacted but NOT truncated. */
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface AgentRunTurnInsert {
  taskId: string;
  agentCrName: string | null;
  eventType: AgentRunTurnType;
  payload: Record<string, unknown>;
}

export interface AgentRunTurnsRepository {
  /** Insert a batch, resolving `agentCrName` to the node identity at write
   *  time exactly like the projection; an uncorrelated row is kept, not
   *  dropped. Returns the inserted count. */
  insertBatch(rows: readonly AgentRunTurnInsert[]): Promise<number>;
  /** One line's turns, ascending by id, capped — the turn-view read. */
  listForAssemblyLine(
    assemblyLineId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]>;
  /** Delete rows older than the horizon; returns the count deleted. */
  pruneOld(olderThanDays: number): Promise<number>;
}

export type { AgentRunEventNodeRef };
