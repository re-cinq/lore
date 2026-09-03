import type { PgPool } from "../../memory-store.js";
import type {
  CostPort,
  AnthropicCostDailyRow,
  GcpCostPort,
  GcpCostDailyRow,
} from "./cost-port.js";

/**
 * Postgres-backed {@link CostPort}: a single upsert into
 * `pipeline.anthropic_cost_daily`. Lifted byte-for-byte from the floor
 * cost-sync job's `upsertRow` so the runner reaches the billing table through
 * the Project facade.
 */
export class PgCost implements CostPort {
  constructor(private readonly pool: PgPool) {}

  async upsertDaily(row: AnthropicCostDailyRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.anthropic_cost_daily
         (bucket_date, model, cost_usd, input_tokens, output_tokens,
          cache_creation_tokens, cache_read_tokens, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (bucket_date, model) DO UPDATE SET
         cost_usd = EXCLUDED.cost_usd,
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         cache_creation_tokens = EXCLUDED.cache_creation_tokens,
         cache_read_tokens = EXCLUDED.cache_read_tokens,
         fetched_at = now()`,
      [
        row.bucketDate,
        row.model,
        row.costUsd,
        row.inputTokens,
        row.outputTokens,
        row.cacheCreationTokens,
        row.cacheReadTokens,
      ],
    );
  }
}

/**
 * Postgres-backed {@link GcpCostPort}: a single upsert into
 * `pipeline.gcp_cost_daily`, the same replace-on-resync shape as the
 * Anthropic table so a restated export bucket overwrites cleanly.
 */
export class PgGcpCost implements GcpCostPort {
  constructor(private readonly pool: PgPool) {}

  async upsertGcpDaily(row: GcpCostDailyRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO pipeline.gcp_cost_daily
         (bucket_date, service, cost_usd, credits_usd, fetched_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (bucket_date, service) DO UPDATE SET
         cost_usd = EXCLUDED.cost_usd,
         credits_usd = EXCLUDED.credits_usd,
         fetched_at = now()`,
      [row.bucketDate, row.service, row.costUsd, row.creditsUsd],
    );
  }
}
