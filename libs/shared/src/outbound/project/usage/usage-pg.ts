import type { PgPool } from "../../memory-store.js";
import type {
  UsagePort,
  LlmCallRecord,
  LlmCallResult,
  ProcessedCounts,
} from "./usage-port.js";

function identityParams(
  record: LlmCallRecord,
): [string | null, string | null, string | null] {
  return [
    record.taskId ?? null,
    record.agentCrName ?? null,
    record.jobName ?? null,
  ];
}

function usageParams(
  record: LlmCallRecord,
): [string, number, number, number, number] {
  return [
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.costUsd ?? 0,
    record.durationMs,
  ];
}

function statusParams(record: LlmCallRecord): [string, string | null] {
  return [record.status ?? "success", record.error ?? null];
}

function carriedParams(record: LlmCallRecord): [string | null, string | null] {
  return [
    record.carried?.assemblyRunId ?? null,
    record.carried?.stationRunId ?? null,
  ];
}

function queryParams(record: LlmCallRecord): unknown[] {
  return [
    ...identityParams(record),
    ...usageParams(record),
    ...statusParams(record),
    ...carriedParams(record),
  ];
}

function correlatedResult(rows: { correlated: boolean }[]): boolean {
  return rows[0]?.correlated ?? false;
}

/** Postgres UsagePort; single INSERT into pipeline.llm_calls. */
export class PgUsage implements UsagePort {
  constructor(private readonly pool: PgPool) {}

  async logLlmCall(record: LlmCallRecord): Promise<LlmCallResult> {
    // Correlate at write time from Agent CR; null CR → uncorrelated (#943,#945,#947).
    const { rows } = await this.pool.query<{ correlated: boolean }>(
      `INSERT INTO pipeline.llm_calls
         (task_id, assembly_line_id, station_run_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms, status, error)
       -- A carried identity ($11/$12) is STATED by the producer and wins over both
       -- guesses — the CR-name lateral and the given-id fallback. Whole, on one
       -- predicate: a stated run beside an inferred station run would be a row
       -- wrong in a way no reader can detect.
       SELECT t.id,
              CASE WHEN $11::uuid IS NULL
                   THEN COALESCE(node.assembly_run_id, al.id) ELSE $11::uuid END,
              CASE WHEN $11::uuid IS NULL
                   THEN node.station_run_id ELSE $12::uuid END,
              $3, $4, $5, $6, $7, $8, $9, $10
         FROM (SELECT $1::uuid AS given, $2::text AS cr) g
         LEFT JOIN pipeline.tasks t ON t.id = g.given
         LEFT JOIN pipeline.assembly_runs al ON al.id = g.given AND t.id IS NULL
         LEFT JOIN LATERAL (
           SELECT n.assembly_run_id, n.station_run_id
             FROM pipeline.station_runs n
            WHERE n.agent_cr_name = g.cr
              -- Only rows that carry no identity need the guess.
              AND $11::uuid IS NULL
            ORDER BY n.id DESC
            LIMIT 1
         ) node ON true
       RETURNING (task_id IS NOT NULL OR assembly_line_id IS NOT NULL) AS correlated`,
      queryParams(record),
    );

    return { correlated: correlatedResult(rows) };
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

  async modelsUsed(stationRunId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ model: string }>(
      `SELECT DISTINCT model FROM pipeline.llm_calls
        WHERE station_run_id = $1 AND model <> '' ORDER BY model`,
      [stationRunId],
    );

    return rows.map((row) => row.model);
  }
}
