import type { PgPool } from "../../memory-store.js";
import type {
  AgentRunTurnInsert,
  AgentRunTurnRow,
  AgentRunTurnType,
  AgentRunTurnsRepository,
} from "./agent-run-turns-port.js";

interface AgentRunTurnDbRow {
  id: string | number;
  task_id: string;
  agent_cr_name: string | null;
  assembly_line_id: string | null;
  node_id: string | null;
  iteration: number | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

function toRow(row: AgentRunTurnDbRow): AgentRunTurnRow {
  return {
    id: String(row.id),
    taskId: row.task_id,
    agentCrName: row.agent_cr_name,
    assemblyLineId: row.assembly_line_id,
    nodeId: row.node_id,
    iteration: row.iteration,
    eventType: row.event_type as AgentRunTurnType,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}

/**
 * Postgres-backed {@link AgentRunTurnsRepository} over
 * `pipeline.agent_run_turns` (migration 0037). Same posture as the
 * projection's adapter: the batch crosses as ONE jsonb parameter (payloads
 * carry agent-controlled text that must never reach statement text), and
 * correlation rides a `LEFT JOIN LATERAL` so an uncorrelated row still
 * inserts with the correlated columns null.
 */
export class PgAgentRunTurns implements AgentRunTurnsRepository {
  constructor(private readonly pool: PgPool) {}

  async insertBatch(rows: readonly AgentRunTurnInsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const batch = rows.map((row) => ({
      task_id: row.taskId,
      agent_cr_name: row.agentCrName,
      event_type: row.eventType,
      payload: row.payload,
    }));

    const { rows: counted } = await this.pool.query<{ count: number }>(
      `WITH inserted AS (
         INSERT INTO pipeline.agent_run_turns (
           task_id, agent_cr_name, assembly_line_id, node_id, iteration,
           event_type, payload
         )
         SELECT v.task_id, v.agent_cr_name, correlated.assembly_line_id,
                correlated.node_id, correlated.iteration, v.event_type, v.payload
         FROM jsonb_to_recordset($1::jsonb) AS v(
           task_id TEXT, agent_cr_name TEXT, event_type TEXT, payload JSONB
         )
         LEFT JOIN LATERAL (
           SELECT node.assembly_line_id, node.node_id, node.iteration
           FROM pipeline.assembly_line_nodes node
           WHERE node.agent_cr_name = v.agent_cr_name
           ORDER BY node.id DESC
           LIMIT 1
         ) correlated ON true
         RETURNING 1
       )
       SELECT count(*)::int AS count FROM inserted`,
      [JSON.stringify(batch)],
    );

    return counted[0]?.count ?? 0;
  }

  async listForAssemblyLine(
    assemblyLineId: string,
    limit: number,
  ): Promise<AgentRunTurnRow[]> {
    const { rows } = await this.pool.query<AgentRunTurnDbRow>(
      `SELECT id, task_id, agent_cr_name, assembly_line_id, node_id,
              iteration, event_type, payload, created_at
         FROM pipeline.agent_run_turns
        WHERE assembly_line_id = $1
        ORDER BY id ASC
        LIMIT $2`,
      [assemblyLineId, limit],
    );

    return rows.map(toRow);
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
}
