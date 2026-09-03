/** pipeline.pod_log_chunks over Postgres; the IO shell for InMemoryPodLogs, which is where the behaviour is specified. */

import type { PgPool } from "../../memory-store.js";
import { fromRow, selectList, type DbRow } from "../../lib/row.js";
import {
  POD_LOG_CHUNK_COLUMNS,
  type PodLogChunk,
} from "../../models/pod-log-chunk.js";
import type { PodLogChunkInsert, PodLogsRepository } from "./pod-logs-port.js";

// Derived from the model's ColumnMap rather than restated here, so the SELECT list and row mapping cannot drift from the table's declaration.
const SELECT_COLUMNS = selectList(POD_LOG_CHUNK_COLUMNS, "c");

function toRow(row: DbRow): PodLogChunk {
  const chunk = fromRow<PodLogChunk>(POD_LOG_CHUNK_COLUMNS, row);

  // String, never a number — the identity column outgrows Number.MAX_SAFE_INTEGER, the same discipline agent_run_events keeps.
  return { ...chunk, id: String(chunk.id) };
}

export class PgPodLogs implements PodLogsRepository {
  constructor(private readonly pool: PgPool) {}

  async appendBatch(chunks: PodLogChunkInsert[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    // One statement with unnested arrays (not a row per round trip) since a busy pod outpaces per-row inserts; ON CONFLICT DO NOTHING no-ops a redelivered batch (expected via the event proxy's retries).
    await this.pool.query(
      `INSERT INTO pipeline.pod_log_chunks
         (agent_cr_name, job_name, pod_name, seq, lines)
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::int[], $5::text[]
       )
       ON CONFLICT (pod_name, seq) DO NOTHING`,
      [
        chunks.map((chunk) => chunk.agentCrName),
        chunks.map((chunk) => chunk.jobName),
        chunks.map((chunk) => chunk.podName),
        chunks.map((chunk) => chunk.seq),
        chunks.map((chunk) => chunk.lines),
      ],
    );
  }

  async listForJob(jobName: string): Promise<PodLogChunk[]> {
    // By pod first, then seq — seq alone would interleave a retried node's two attempts; MIN(id) per pod gives first-appearance order. In-memory double sorts the same way (test pins it).
    const { rows } = await this.pool.query<DbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM pipeline.pod_log_chunks c
         JOIN (
           SELECT pod_name, MIN(id) AS first_id
             FROM pipeline.pod_log_chunks
            WHERE job_name = $1
            GROUP BY pod_name
         ) p ON c.pod_name = p.pod_name
        WHERE c.job_name = $1
        ORDER BY p.first_id, c.seq ASC`,
      [jobName],
    );

    return rows.map(toRow);
  }

  async pruneOld(olderThanDays: number): Promise<number> {
    // Counted through a CTE rather than rowCount (matching agent_run_events) since the pool's query type doesn't surface it.
    const { rows } = await this.pool.query<{ count: number }>(
      `WITH deleted AS (
         DELETE FROM pipeline.pod_log_chunks
          WHERE created_at < now() - make_interval(days => $1)
        RETURNING 1
       )
       SELECT count(*)::int AS count FROM deleted`,
      [olderThanDays],
    );

    return rows[0]?.count ?? 0;
  }
}
