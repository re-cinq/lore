import type { PgPool } from "../../memory-store.js";
import { AGENT_RUN_TURN_COLUMNS } from "../../models/agent-run-turn.js";
import type { AgentRunTurnSchema } from "../../models/agent-run-turn.js";
import type { WireOf } from "../../lib/wire-schema.js";
import type { CarriedRunIdentity } from "../run-identity/carried-run-identity.js";
import {
  compareTurnIdAscending,
  type AgentRunTurnInsert,
  type AgentRunTurnRow,
  type AgentRunTurnsRepository,
} from "./agent-run-turns-port.js";

/** The shape `RETURNING *`/`SELECT` hands back; `id` widens past the model since a small bigint can come back as a number. */
type AgentRunTurnDbRow = Omit<
  WireOf<typeof AgentRunTurnSchema.shape, typeof AGENT_RUN_TURN_COLUMNS>,
  "id"
> & { id: string | number };

const SELECT_COLUMNS = `id, task_id, agent_cr_name, assembly_line_id, station_run_id, node_id,
         iteration, event_type, envelope, created_at`;

function toRow(row: AgentRunTurnDbRow): AgentRunTurnRow {
  return {
    id: String(row.id),
    taskId: row.task_id,
    agentCrName: row.agent_cr_name,
    assemblyLineId: row.assembly_line_id,
    stationRunId: row.station_run_id,
    nodeId: row.node_id,
    iteration: row.iteration,
    eventType: row.event_type,
    envelope: row.envelope,
    createdAt: row.created_at,
  };
}

/** Reads one field off `carried`, or `null` when the event carried no identity at all. */
function carriedField<T>(
  carried: CarriedRunIdentity | null | undefined,
  pick: (identity: CarriedRunIdentity) => T,
): T | null {
  return carried ? pick(carried) : null;
}

function toBatchRow(row: AgentRunTurnInsert): Record<string, unknown> {
  return {
    task_id: row.taskId,
    agent_cr_name: row.agentCrName,
    assembly_run_id: carriedField(row.carried, (c) => c.assemblyRunId),
    node_id: carriedField(row.carried, (c) => c.nodeId),
    iteration: carriedField(row.carried, (c) => c.iteration),
    station_run_id: carriedField(row.carried, (c) => c.stationRunId),
    event_type: row.eventType,
    envelope: row.envelope,
    dedup_key: row.dedupKey ?? null,
  };
}

/** Postgres-backed {@link AgentRunTurnsRepository}. Batch as ONE jsonb parameter via jsonb_to_recordset (varies row count, agent-controlled text never in statement). Envelope as TEXT cast in statement (no roundtrip). Correlation via LEFT JOIN LATERAL for resilience. */
export class PgAgentRunTurns implements AgentRunTurnsRepository {
  constructor(private readonly pool: PgPool) {}

  async insertBatch(
    rows: readonly AgentRunTurnInsert[],
  ): Promise<AgentRunTurnRow[]> {
    if (rows.length === 0) {
      return [];
    }

    const batch = rows.map(toBatchRow);

    const { rows: inserted } = await this.pool.query<AgentRunTurnDbRow>(
      `INSERT INTO pipeline.agent_run_turns (
         task_id, agent_cr_name, assembly_line_id, station_run_id, node_id,
         iteration, event_type, envelope, dedup_key
       )
       -- Every branch keys on the SAME predicate, so the identity comes whole
       -- from one source — see agent-run-events-pg for why mixing is worse than
       -- either alternative.
       SELECT v.task_id, v.agent_cr_name,
              CASE WHEN v.assembly_run_id IS NULL
                   THEN correlated.assembly_run_id ELSE v.assembly_run_id END,
              CASE WHEN v.assembly_run_id IS NULL
                   THEN correlated.station_run_id ELSE v.station_run_id END,
              CASE WHEN v.assembly_run_id IS NULL
                   THEN correlated.node_id ELSE v.node_id END,
              CASE WHEN v.assembly_run_id IS NULL
                   THEN correlated.iteration ELSE v.iteration END,
              v.event_type,
              v.envelope::jsonb,
              v.dedup_key
       FROM jsonb_to_recordset($1::jsonb) AS v(
         task_id TEXT, agent_cr_name TEXT, assembly_run_id UUID, node_id TEXT,
         iteration INT, station_run_id UUID, event_type TEXT, envelope TEXT,
         dedup_key TEXT
       )
       -- Same rule as agent_run_events: CR names are unique per line, so the
       -- DESC tie-break only fires when two DIFFERENT lines collide on their
       -- 12-hex id prefix + node id + iteration; the newest node row wins then.
       LEFT JOIN LATERAL (
         SELECT node.assembly_run_id, node.station_run_id, node.node_id,
                node.iteration
         FROM pipeline.station_runs node
         WHERE node.agent_cr_name = v.agent_cr_name
           -- Only rows that carry no identity need the guess.
           AND v.assembly_run_id IS NULL
         ORDER BY node.id DESC
         LIMIT 1
       ) correlated ON true
       -- Re-ingest dedup (#1389): a duplicate dedup_key skips its row, never
       -- fails the batch. Deliberately NO arbiter target: naming the partial
       -- index would 42P10-fail every insert on a database where the column
       -- exists but the index was dropped by hand — the bare form degrades
       -- that to duplicates instead of total turn loss. The cost: conflicts
       -- on ANY future unique index on this table would be swallowed here
       -- and mis-attributed to turn_deduped.
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [JSON.stringify(batch)],
    );

    return inserted.map(toRow).sort(compareTurnIdAscending);
  }

  async listByLine(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    return this.page("assembly_line_id", assemblyLineId, afterId, limit);
  }

  async listByTask(
    taskId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    return this.page("task_id", taskId, afterId, limit);
  }

  async pruneOld(olderThanDays: number): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>(
      `WITH deleted AS (
         DELETE FROM pipeline.agent_run_turns
          WHERE created_at < now() - make_interval(days => $1)
        RETURNING 1
       )
       SELECT count(*)::int AS count FROM deleted`,
      [olderThanDays],
    );

    return rows[0]?.count ?? 0;
  }

  /** The two reads differ only in which correlation column scopes them; column name is a literal from this file, never caller input. */
  private async page(
    scopeColumn: "assembly_line_id" | "task_id",
    scopeValue: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    const { rows } = await this.pool.query<AgentRunTurnDbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM pipeline.agent_run_turns
        WHERE ${scopeColumn} = $1
          AND id > $2::bigint
        ORDER BY id ASC
        LIMIT $3`,
      [scopeValue, afterId, limit],
    );

    return rows.map(toRow);
  }
}
