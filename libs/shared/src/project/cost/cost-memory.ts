import type { CostPort, AnthropicCostDailyRow } from "./cost-port.js";

/**
 * In-memory {@link CostPort}: models the table's upsert semantics so a test
 * can assert them. Each write replaces the existing row sharing the same
 * `(bucketDate, model)` key, or appends a new one — mirroring
 * `ON CONFLICT (bucket_date, model) DO UPDATE`.
 */
export class InMemoryCost implements CostPort {
  readonly rows: AnthropicCostDailyRow[] = [];

  async upsertDaily(row: AnthropicCostDailyRow): Promise<void> {
    const index = this.rows.findIndex(
      (existing) =>
        existing.bucketDate === row.bucketDate && existing.model === row.model,
    );

    if (index === -1) {
      this.rows.push({ ...row });

      return;
    }
    this.rows[index] = { ...row };
  }
}
