import { describe, it, expect } from "vitest";
import { vendorSplit } from "./vendor-split.js";

describe("vendorSplit", () => {
  it("folds the by-model rollup into per-vendor totals, dearest vendor first", () => {
    expect(
      vendorSplit([
        { model: "claude-sonnet-4-6", calls: 50, cost_usd: 85.55 },
        { model: "gemini-3.1-pro-preview", calls: 40, cost_usd: 53.52 },
        { model: "claude-haiku-4-5-20251001", calls: 153, cost_usd: 28.1 },
        { model: "gemini-3-flash-preview", calls: 10, cost_usd: 13.16 },
      ]),
    ).toEqual([
      { vendor: "anthropic", calls: 203, cost_usd: 113.65 },
      { vendor: "gemini", calls: 50, cost_usd: 66.68 },
    ]);
  });

  it("counts the empty non-token model against anthropic", () => {
    expect(vendorSplit([{ model: "", calls: 3, cost_usd: 12.75 }])).toEqual([
      { vendor: "anthropic", calls: 3, cost_usd: 12.75 },
    ]);
  });

  it("returns no rows for an interval with no calls", () => {
    expect(vendorSplit([])).toEqual([]);
  });
});
