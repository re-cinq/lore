import type {
  AgentRunEvent,
  AgentRunEventType,
} from "../../models/agent-run-event.js";

export type { AgentRunEventType };

/**
 * One row of `pipeline.agent_run_events` — the canonical per-tool-call agent
 * telemetry contract for the whole run-visualization epic. The shape is the
 * `AgentRunEvent` model; see `libs/shared/src/models/agent-run-event.ts` for the
 * columns, why `id` stays a string, and why `assemblyLineId` keeps its
 * pre-rename spelling.
 */
export type AgentRunEventRow = AgentRunEvent;

/**
 * What the projector supplies for one row. The correlated fields
 * (`assemblyLineId`, `nodeId`, `iteration`) are absent by design — the
 * repository resolves them from `agentCrName` at write time — as are `id` and
 * `createdAt`, which the database mints.
 */
import type { CarriedRunIdentity } from "../run-identity/carried-run-identity.js";

export interface AgentRunEventInsert {
  taskId: string;
  agentCrName: string | null;
  /**
   * The identity the EVENT stated, when its producer knew it (#1147). Present it
   * and the `agentCrName` lookup is not consulted at all; absent, the lookup
   * stays in charge. One grouped object rather than four loose fields, so a
   * half-stated identity is not expressible.
   */
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
  /** The visit's own id — what correlated rows key on. Nullable as well as
   *  optional: a seeded node may predate station-run identity. */
  stationRunId?: string | null;
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
