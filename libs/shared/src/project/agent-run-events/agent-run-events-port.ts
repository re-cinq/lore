import type {
  AgentRunEvent,
  AgentRunEventType,
} from "../../models/agent-run-event.js";

export type { AgentRunEventType };

/** One pipeline.agent_run_events row — canonical per-tool-call telemetry (see models/agent-run-event.ts for columns, why id is a string, and why assemblyLineId keeps its pre-rename spelling). */
export type AgentRunEventRow = AgentRunEvent;

/** What the projector supplies for one row; correlated fields (assemblyLineId/nodeId/iteration) are absent by design (resolved from agentCrName at write time), as are db-minted id/createdAt. */
import type { CarriedRunIdentity } from "../run-identity/carried-run-identity.js";

export interface AgentRunEventInsert {
  taskId: string;
  agentCrName: string | null;
  /** Identity the event itself stated, if known (#1147) — present skips the agentCrName lookup entirely; grouped so a half-stated identity can't be expressed. */
  carried?: CarriedRunIdentity | null;
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
  /** The visit's own id, what correlated rows key on; nullable+optional since a seeded node may predate station-run identity. */
  stationRunId?: string | null;
  agentCrName: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
}

/** Per-tool-call agent telemetry surface: ingest writes via insertBatch, SSE catches up via listSince, retention cron reaps via pruneOld. */
export interface AgentRunEventsRepository {
  /** Inserts a batch, resolving agentCrName to assemblyLineId/nodeId/iteration at write time; an uncorrelated row is still inserted with those fields null. Returns rows ascending by id so the caller can publish to SSE without a re-read. */
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
