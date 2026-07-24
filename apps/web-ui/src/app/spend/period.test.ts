import { describe, it, expect } from "vitest";
import { resolveSpendPeriod, SPEND_PERIODS } from "./period";

describe("resolveSpendPeriod", () => {
  it("returns the matching period for a known key", () => {
    expect(resolveSpendPeriod("week").key).toBe("week");
    expect(resolveSpendPeriod("90d").label).toBe("Last 90 days");
  });

  it("defaults to this month for an unknown, missing, or null value", () => {
    expect(resolveSpendPeriod(undefined).key).toBe("month");
    expect(resolveSpendPeriod(null).key).toBe("month");
    expect(resolveSpendPeriod("bogus").key).toBe("month");
  });

  it("exposes the five periods in selector order", () => {
    expect(SPEND_PERIODS.map((p) => p.key)).toEqual([
      "week",
      "month",
      "30d",
      "90d",
      "all",
    ]);
  });

  it("keeps every floor a constant sql expression, never the raw input", () => {
    for (const p of SPEND_PERIODS) {
      expect(p.floorSql).toMatch(/date_trunc|current_date|date '/);
    }
  });
});
