import type { PgPool } from "../../memory-store.js";
import type {
  AgentRunEventInsert,
  AgentRunEventRow,
  AgentRunEventType,
  AgentRunEventsRepository,
} from "./agent-run-events-port.js";

/** The shape `pipeline.agent_run_events` hands back from `RETURNING *`. */
interface AgentRunEventDbRow {
  id: string | number;
  task_id: string;
  agent_cr_name: string | null;
  assembly_line_id: string | null;
  node_id: string | null;
  iteration: number | null;
  event_type: string;
  tool_name: string | null;
  tool_use_id: string | null;
  is_error: boolean;
  file_paths: string[] | null;
  summary: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

const SELECT_COLUMNS = `id, task_id, agent_cr_name, assembly_line_id, node_id,
         iteration, event_type, tool_name, tool_use_id, is_error,
         file_paths, summary, payload, created_at`;

function toRow(row: AgentRunEventDbRow): AgentRunEventRow {
  return {
    id: String(row.id),
    taskId: row.task_id,
    agentCrName: row.agent_cr_name,
    assemblyLineId: row.assembly_line_id,
    nodeId: row.node_id,
    iteration: row.iteration,
    eventType: row.event_type as AgentRunEventType,
    toolName: row.tool_name,
    toolUseId: row.tool_use_id,
    isError: row.is_error,
    filePaths: row.file_paths ?? [],
    summary: row.summary,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  };
}

function byIdAscending(a: AgentRunEventRow, b: AgentRunEventRow): number {
  return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
}

/**
 * Postgres-backed {@link AgentRunEventsRepository}.
 *
 * The batch crosses as ONE jsonb parameter expanded by `jsonb_to_recordset`
 * rather than a string-built VALUES list: the row count varies per POST, and
 * `file_paths` / `payload` carry agent-controlled text that must never reach
 * the statement text. Correlation rides a `LEFT JOIN LATERAL` so a row whose
 * `agent_cr_name` matches no node still inserts (with the correlated columns
 * null) instead of being filtered out by an inner join.
 */
export class PgAgentRunEvents implements AgentRunEventsRepository {
  constructor(private readonly pool: PgPool) {}

  async insertBatch(
    rows: readonly AgentRunEventInsert[],
  ): Promise<AgentRunEventRow[]> {
    if (rows.length === 0) {
      return [];
    }

    const batch = rows.map((row) => ({
      task_id: row.taskId,
      agent_cr_name: row.agentCrName,
      event_type: row.eventType,
      tool_name: row.toolName ?? null,
      tool_use_id: row.toolUseId ?? null,
      is_error: row.isError ?? false,
      file_paths: [...(row.filePaths ?? [])],
      summary: row.summary ?? null,
      payload: row.payload ?? {},
    }));

    const { rows: inserted } = await this.pool.query<AgentRunEventDbRow>(
      `INSERT INTO pipeline.agent_run_events (
         task_id, agent_cr_name, assembly_line_id, node_id, iteration,
         event_type, tool_name, tool_use_id, is_error, file_paths, summary, payload
       )
       SELECT v.task_id, v.agent_cr_name, correlated.assembly_line_id,
              correlated.node_id, correlated.iteration, v.event_type,
              v.tool_name, v.tool_use_id, v.is_error, v.file_paths,
              v.summary, v.payload
       FROM jsonb_to_recordset($1::jsonb) AS v(
         task_id TEXT, agent_cr_name TEXT, event_type TEXT, tool_name TEXT,
         tool_use_id TEXT, is_error BOOLEAN, file_paths TEXT[], summary TEXT,
         payload JSONB
       )
       -- CR names are unique per line (a revisited node's iteration gets its
       -- own -<n> suffix), so the DESC tie-break only fires when two DIFFERENT
       -- lines collide on their 12-hex id prefix + node id + iteration; the
       -- newest node row wins then. Fork-and-rerun preserves this: copied
       -- node rows null agent_cr_name (assembly-lines-pg startResumed), so a
       -- fork never matches its source's CR names here.
       LEFT JOIN LATERAL (
         SELECT node.assembly_line_id, node.node_id, node.iteration
         FROM pipeline.assembly_line_nodes node
         WHERE node.agent_cr_name = v.agent_cr_name
         ORDER BY node.id DESC
         LIMIT 1
       ) correlated ON true
       RETURNING *`,
      [JSON.stringify(batch)],
    );

    return inserted.map(toRow).sort(byIdAscending);
  }

  async listSince(
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ): Promise<AgentRunEventRow[]> {
    const { rows } = await this.pool.query<AgentRunEventDbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM pipeline.agent_run_events
        WHERE assembly_line_id = $1
          AND id > $2::bigint
        ORDER BY id ASC
        LIMIT $3`,
      [assemblyLineId, afterId, limit],
    );

    return rows.map(toRow);
  }

  async pruneOld(olderThanDays: number): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>(
      `WITH deleted AS (
         DELETE FROM pipeline.agent_run_events
          WHERE created_at < now() - make_interval(days => $1)
        RETURNING 1
       )
       SELECT count(*)::int AS count FROM deleted`,
      [olderThanDays],
    );

    return rows[0]?.count ?? 0;
  }
}
