import type { AgentRunTurn } from "../../models/agent-run-turn.js";

/** One row of pipeline.agent_run_turns — full-fidelity turn-level transcript store (specs/turn-level-transcript-store), sibling to deliberately truncated agent_run_events. id is string-encoded bigint across all wires (outgrows MAX_SAFE_INTEGER, doubles as read cursor). All correlation fields nullable (fidelity store must not drop unlabeled lines). */
export type AgentRunTurnRow = AgentRunTurn;

/** Ingest tee input per turn. Correlated fields (assemblyLineId, nodeId, iteration) resolved from agentCrName at write time; id and createdAt minted by database. */
import type { CarriedRunIdentity } from "../run-identity/carried-run-identity.js";

export interface AgentRunTurnInsert {
  taskId: string | null;
  agentCrName: string | null;
  /** The identity the turn STATED, when its producer knew it (#1147). Present it and the agentCrName lookup is not consulted. */
  carried?: CarriedRunIdentity | null;
  eventType: string | null;
  /** Envelope as JSON **text**, not parsed object: ingest path already holds raw NDJSON line as string, handing string straight through means hot path neither re-parses nor re-serializes. Adapter casts to jsonb in statement; readers get it back parsed. */
  envelope: string;
  /** Idempotency key for re-ingested lines (#1389): task-turns relay stamps one per relayed line, so retried POST skips rows already stored instead of duplicating transcript. Null/absent (every non-relay producer) means "never dedup" — the fidelity default. */
  dedupKey?: string | null;
}

/** Order two rows by their string-encoded bigint id, ascending. Lives on port because "rows come back ascending by id" is the port contract; both adapters need it. Comparator that never returns 0 is not a total order, and Array#sort is free to do anything with one. */
export function compareTurnIdAscending(
  a: AgentRunTurnRow,
  b: AgentRunTurnRow,
): number {
  const left = BigInt(a.id);
  const right = BigInt(b.id);

  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

/** A node identity the correlation lookup can resolve an `agentCrName` to. */
export interface AgentRunTurnNodeRef {
  /** The visit's own id — what correlated rows key on. */
  stationRunId?: string | null;
  agentCrName: string;
  assemblyLineId: string;
  nodeId: string;
  iteration: number;
}

/** The turn-level transcript surface: ingest tee writes through insertBatch, post-mortems page through listByLine / listByTask, retention cron reaps through pruneOld. */
export interface AgentRunTurnsRepository {
  /** Insert a batch, resolving agentCrName to (assemblyLineId, nodeId, iteration) against pipeline.station_runs at write time. Turns that correlate to nothing still insert with agentCrName retained, correlated fields null. Rows with non-null dedupKey already stored are skipped silently — never batch failure. Returns rows THIS CALL inserted, ascending by id. */
  insertBatch(rows: readonly AgentRunTurnInsert[]): Promise<AgentRunTurnRow[]>;
  /** One assembly line's turns with id > afterId, ascending, capped. */
  listByLine(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]>;
  /** One task's turns with id > afterId, ascending, capped — only path to rows that correlate to no assembly-line node. */
  listByTask(
    taskId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]>;
  /** Delete turns older than the horizon; returns the count deleted. */
  pruneOld(olderThanDays: number): Promise<number>;
}
