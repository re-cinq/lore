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
    await this.pool.query(
      `INSERT INTO pipeline.llm_calls
         (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
    const { rows: todayRows } = await this.pool.query(
      "SELECT count(*)::int as today FROM pipeline.llm_calls WHERE created_at > current_date",
    );
    const { rows: totalRows } = await this.pool.query(
      "SELECT count(*)::int as total FROM pipeline.llm_calls",
    );

    return {
      today: todayRows[0]?.today ?? 0,
      total: totalRows[0]?.total ?? 0,
    };
  }
}
