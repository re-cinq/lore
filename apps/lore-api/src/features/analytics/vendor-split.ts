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

/**
 * Fold the by-model rollup into per-vendor totals.
 *
 * Derived from rows the handler already fetched rather than a second GROUP BY:
 * the vendor of a model id is a fact about the id, and expressing it as SQL
 * would put the classification in two places — the balance query already reads
 * the shared patterns, and this reads the shared classifier.
 *
 * Sorted by cost descending so the reader sees where the money went; ties break
 * on vendor name, so the order is stable across refreshes.
 */
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
