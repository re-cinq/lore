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
  station_run_id: string | null;
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

const SELECT_COLUMNS = `id, task_id, agent_cr_name, assembly_line_id, station_run_id, node_id,
         iteration, event_type, tool_name, tool_use_id, is_error,
         file_paths, summary, payload, created_at`;

function toRow(row: AgentRunEventDbRow): AgentRunEventRow {
  return {
    id: String(row.id),
    taskId: row.task_id,
    agentCrName: row.agent_cr_name,
    assemblyLineId: row.assembly_line_id,
    stationRunId: row.station_run_id,
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

/** Postgres-backed {@link AgentRunEventsRepository}. Batch as ONE jsonb parameter via jsonb_to_recordset (varies row count, agent-controlled text never in statement). Correlation via LEFT JOIN LATERAL for resilience. */
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
      assembly_run_id: row.carried?.assemblyRunId ?? null,
      node_id: row.carried?.nodeId ?? null,
      iteration: row.carried?.iteration ?? null,
      station_run_id: row.carried?.stationRunId ?? null,
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
         task_id, agent_cr_name, assembly_line_id, station_run_id, node_id, iteration,
         event_type, tool_name, tool_use_id, is_error, file_paths, summary, payload
       )
       -- Every branch keys on the SAME predicate, so a row takes its identity
       -- whole from one source. Per-column COALESCE would let a stated run id sit
       -- beside an inferred node id — a row wrong in a way no reader can detect.
       -- A carried station_run_id of NULL is kept as NULL rather than falling
       -- through to the guess, for the same reason.
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
              v.tool_name, v.tool_use_id, v.is_error, v.file_paths,
              v.summary, v.payload
       FROM jsonb_to_recordset($1::jsonb) AS v(
         task_id TEXT, agent_cr_name TEXT, assembly_run_id UUID, node_id TEXT,
         iteration INT, station_run_id UUID, event_type TEXT, tool_name TEXT,
         tool_use_id TEXT, is_error BOOLEAN, file_paths TEXT[], summary TEXT,
         payload JSONB
       )
       -- The station run id is what downstream readers key on (FR6.39); the CR
       -- name is resolved to it HERE, once, instead of every reader re-deriving
       -- which visit a name meant.
       -- CR names are unique per line (a revisited node's iteration gets its
       -- own -<n> suffix), so the DESC tie-break only fires when two DIFFERENT
       -- lines collide on their 12-hex id prefix + node id + iteration; the
       -- newest node row wins then. Fork-and-rerun preserves this: copied
       -- node rows null agent_cr_name (assembly-lines-pg startResumed), so a
       -- fork never matches its source's CR names here.
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
