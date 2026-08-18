import type { PgPool } from "../../memory-store.js";
import {
  compareTurnIdAscending,
  type AgentRunTurnInsert,
  type AgentRunTurnRow,
  type AgentRunTurnsRepository,
} from "./agent-run-turns-port.js";

/** The shape `pipeline.agent_run_turns` hands back from `RETURNING *`. */
interface AgentRunTurnDbRow {
  id: string | number;
  task_id: string | null;
  agent_cr_name: string | null;
  assembly_line_id: string | null;
  station_run_id: string | null;
  node_id: string | null;
  iteration: number | null;
  event_type: string | null;
  envelope: Record<string, unknown>;
  created_at: Date;
}

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

/**
 * Postgres-backed {@link AgentRunTurnsRepository}.
 *
 * The batch crosses as ONE jsonb parameter expanded by `jsonb_to_recordset`
 * rather than a string-built VALUES list: the row count varies per POST, and a
 * turn envelope is verbatim agent-controlled text that must never reach the
 * statement text. The envelope itself is bound as TEXT and cast in the
 * statement, so the ingest path hands through the raw line it already holds
 * instead of round-tripping it through a JS object.
 *
 * Correlation rides a `LEFT JOIN LATERAL` so a turn whose `agent_cr_name`
 * matches no node still inserts (with the correlated columns null) instead of
 * being filtered out by an inner join.
 */
export class PgAgentRunTurns implements AgentRunTurnsRepository {
  constructor(private readonly pool: PgPool) {}

  async insertBatch(
    rows: readonly AgentRunTurnInsert[],
  ): Promise<AgentRunTurnRow[]> {
    if (rows.length === 0) {
      return [];
    }

    const batch = rows.map((row) => ({
      task_id: row.taskId,
      agent_cr_name: row.agentCrName,
      assembly_run_id: row.carried?.assemblyRunId ?? null,
      node_id: row.carried?.nodeId ?? null,
      iteration: row.carried?.iteration ?? null,
      station_run_id: row.carried?.stationRunId ?? null,
      event_type: row.eventType,
      envelope: row.envelope,
    }));

    const { rows: inserted } = await this.pool.query<AgentRunTurnDbRow>(
      `INSERT INTO pipeline.agent_run_turns (
         task_id, agent_cr_name, assembly_line_id, station_run_id, node_id,
         iteration, event_type, envelope
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
              v.envelope::jsonb
       FROM jsonb_to_recordset($1::jsonb) AS v(
         task_id TEXT, agent_cr_name TEXT, assembly_run_id UUID, node_id TEXT,
         iteration INT, station_run_id UUID, event_type TEXT, envelope TEXT
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

  /** The two reads differ only in which correlation column scopes them; the
   *  column name is a literal from this file, never caller input. */
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
