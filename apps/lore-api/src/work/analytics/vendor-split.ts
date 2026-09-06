import { modelVendor } from "@re-cinq/lore-shared/llm/model-vendor.js";

/** One model's slice of the interval, as the by-model rollup already returns it. */
export interface ModelCostRow {
  model: string;
  calls: number;
  cost_usd: number;
}

export interface VendorCostRow {
  vendor: string;
  calls: number;
  cost_usd: number;
}

// Fold by-model into per-vendor totals; sorted by cost descending (stable on vendor name).
export function vendorSplit(rows: ModelCostRow[]): VendorCostRow[] {
  const totals = new Map<string, VendorCostRow>();

  for (const row of rows) {
    const vendor = modelVendor(row.model);
    const entry = totals.get(vendor) ?? { vendor, calls: 0, cost_usd: 0 };

    entry.calls += Number(row.calls) || 0;
    entry.cost_usd += Number(row.cost_usd) || 0;
    totals.set(vendor, entry);
  }

  return [...totals.values()].sort(
    (a, b) => b.cost_usd - a.cost_usd || a.vendor.localeCompare(b.vendor),
  );
}
