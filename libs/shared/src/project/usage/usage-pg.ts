import type { PgPool } from "../../memory-store.js";
import type {
  UsagePort,
  LlmCallRecord,
  LlmCallResult,
  ProcessedCounts,
} from "./usage-port.js";

/**
 * Postgres-backed {@link UsagePort}: a single INSERT into
 * `pipeline.llm_calls`. Relocated from the agent's claude-code spawner so
 * usage accounting reaches the table through the Project facade.
 */
export class PgUsage implements UsagePort {
  constructor(private readonly pool: PgPool) {}

  async logLlmCall(record: LlmCallRecord): Promise<LlmCallResult> {
    // Correlate at write time (mirroring agent-run-events-pg):
    //   task_id          — the given id when it is a task
    //   assembly_line_id — resolved from the Agent CR name against
    //                      assembly_line_nodes (the exact attempt, so a
    //                      task-backed run gets per-attempt cost, #947); falls
    //                      back to the given id when it is itself a line id (the
    //                      task-less pods that post `taskId ?? row.id`, #943).
    // A null CR compares as NULL under `n.agent_cr_name = g.cr` (never true), so
    // the lateral yields no row and COALESCE falls through to al.id — the intended
    // no-op, same as agent-run-events-pg. An id/CR matching nothing keeps the row
    // uncorrelated (both null) rather than failing the FK; RETURNING reports that
    // so the sink can surface it (#945).
    const { rows } = await this.pool.query<{ correlated: boolean }>(
      `INSERT INTO pipeline.llm_calls
         (task_id, assembly_line_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
       SELECT t.id, COALESCE(node.assembly_line_id, al.id), $3, $4, $5, $6, $7, $8
         FROM (SELECT $1::uuid AS given, $2::text AS cr) g
         LEFT JOIN pipeline.tasks t ON t.id = g.given
         LEFT JOIN pipeline.assembly_lines al ON al.id = g.given AND t.id IS NULL
         LEFT JOIN LATERAL (
           SELECT n.assembly_line_id
             FROM pipeline.assembly_line_nodes n
            WHERE n.agent_cr_name = g.cr
            ORDER BY n.id DESC
            LIMIT 1
         ) node ON true
       RETURNING (task_id IS NOT NULL OR assembly_line_id IS NOT NULL) AS correlated`,
      [
        record.taskId ?? null,
        record.agentCrName ?? null,
        record.jobName,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.costUsd ?? 0,
        record.durationMs,
      ],
    );

    return { correlated: rows[0]?.correlated ?? false };
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
