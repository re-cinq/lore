import type { PgPool } from "../../memory-store.js";
import type {
  UsagePort,
  LlmCallRecord,
  ProcessedCounts,
} from "./usage-port.js";

/**
 * Postgres-backed {@link UsagePort}: a single INSERT into
 * `pipeline.llm_calls`. Relocated from the agent's claude-code spawner so
 * usage accounting reaches the table through the Project facade.
 */
export class PgUsage implements UsagePort {
  constructor(private readonly pool: PgPool) {}

  async logLlmCall(record: LlmCallRecord): Promise<void> {
    // A task-less line's pod posts its cost keyed by the assembly-line id (the
    // `taskId ?? row.id` fallback in advance.ts). Route the id to task_id when
    // it is a task and to assembly_line_id when it is a line — write-time
    // correlation mirroring agent-run-events-pg. An id in neither table keeps
    // the row uncorrelated (both null) rather than failing the FK.
    await this.pool.query(
      `INSERT INTO pipeline.llm_calls
         (task_id, assembly_line_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
       SELECT t.id, al.id, $2, $3, $4, $5, $6, $7
         FROM (SELECT $1::uuid AS given) g
         LEFT JOIN pipeline.tasks t ON t.id = g.given
         LEFT JOIN pipeline.assembly_lines al ON al.id = g.given AND t.id IS NULL`,
      [
        record.taskId ?? null,
        record.jobName,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.costUsd ?? 0,
        record.durationMs,
      ],
    );
  }

  async processedCounts(): Promise<ProcessedCounts> {
    const { rows: todayRows } = await this.pool.query<{ today: number }>(
      "SELECT count(*)::int as today FROM pipeline.llm_calls WHERE created_at > current_date",
    );
    const { rows: totalRows } = await this.pool.query<{ total: number }>(
      "SELECT count(*)::int as total FROM pipeline.llm_calls",
    );

    return {
      today: todayRows[0]?.today ?? 0,
      total: totalRows[0]?.total ?? 0,
    };
  }
}
