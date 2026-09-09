import type {
  CostPort,
  AnthropicCostDailyRow,
  GcpCostPort,
  GcpCostDailyRow,
} from "./cost-port.js";

/** In-memory CostPort: models upsert semantics per (bucketDate, model) key. */
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

/** In-memory GcpCostPort: models upsert semantics per (bucketDate, service) key. */
export class InMemoryGcpCost implements GcpCostPort {
  readonly rows: GcpCostDailyRow[] = [];

  async upsertGcpDaily(row: GcpCostDailyRow): Promise<void> {
    const index = this.rows.findIndex(
      (existing) =>
        existing.bucketDate === row.bucketDate &&
        existing.service === row.service,
    );

    if (index === -1) {
      this.rows.push({ ...row });

      return;
    }
    this.rows[index] = { ...row };
  }
}
