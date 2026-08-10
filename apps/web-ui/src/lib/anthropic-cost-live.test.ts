import { describe, it, expect } from "vitest";
import {
  aggregateMonthToDate,
  monthStart,
  type LiveCostRow,
} from "./anthropic-cost-live";

function row(over: Partial<LiveCostRow> = {}): LiveCostRow {
  return {
    date: "2026-08-10",
    model: "claude-opus-5",
    costUsd: 10,
    inputTokens: 1000,
    outputTokens: 100,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    ...over,
  };
}

const FETCHED_AT = "2026-08-10T13:00:00.000Z";

describe("monthStart", () => {
  it("returns 2026-08-01 for a mid-August date", () => {
    expect(monthStart(new Date("2026-08-10T13:00:00.000Z"))).toBe("2026-08-01");
  });

  it("zero-pads single-digit months", () => {
    expect(monthStart(new Date("2026-03-31T23:59:59.000Z"))).toBe("2026-03-01");
  });

  it("uses the UTC month for a timestamp that is a different month locally", () => {
    expect(monthStart(new Date("2026-09-01T00:30:00.000Z"))).toBe("2026-09-01");
  });
});

describe("aggregateMonthToDate", () => {
  it("sums cost and tokens across every row in the month", () => {
    const result = aggregateMonthToDate(
      [row({ costUsd: 10 }), row({ costUsd: 2.5, model: "claude-haiku-4-5" })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd).toEqual({
      billed_usd: 12.5,
      input_tokens: 2000,
      output_tokens: 200,
      as_of: FETCHED_AT,
    });
  });

  it("excludes rows dated before the month start", () => {
    const result = aggregateMonthToDate(
      [row({ date: "2026-07-31", costUsd: 999 }), row({ costUsd: 10 })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd.billed_usd).toBe(10);
    expect(result.orgDaily).toEqual([
      { bucket_date: "2026-08-10", cost_usd: 10 },
    ]);
  });

  it("returns a null as_of when the month has no rows", () => {
    const result = aggregateMonthToDate(
      [row({ date: "2026-07-15" })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd).toEqual({
      billed_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      as_of: null,
    });
  });

  it("groups by model and orders by cost descending", () => {
    const result = aggregateMonthToDate(
      [
        row({ model: "claude-haiku-4-5", costUsd: 1 }),
        row({ model: "claude-opus-5", costUsd: 30, date: "2026-08-09" }),
        row({ model: "claude-opus-5", costUsd: 5 }),
      ],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgByModel).toEqual([
      {
        model: "claude-opus-5",
        cost_usd: 35,
        input_tokens: 2000,
        output_tokens: 200,
      },
      {
        model: "claude-haiku-4-5",
        cost_usd: 1,
        input_tokens: 1000,
        output_tokens: 100,
      },
    ]);
  });

  it("groups by day across models and orders by date descending", () => {
    const result = aggregateMonthToDate(
      [
        row({ date: "2026-08-09", costUsd: 3 }),
        row({ date: "2026-08-10", costUsd: 4, model: "claude-haiku-4-5" }),
        row({ date: "2026-08-10", costUsd: 6 }),
      ],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgDaily).toEqual([
      { bucket_date: "2026-08-10", cost_usd: 10 },
      { bucket_date: "2026-08-09", cost_usd: 3 },
    ]);
  });

  it("includes a row dated exactly on the month start", () => {
    const result = aggregateMonthToDate(
      [row({ date: "2026-08-01", costUsd: 7 })],
      FETCHED_AT,
      "2026-08-01",
    );

    expect(result.orgMtd.billed_usd).toBe(7);
    expect(result.orgDaily).toEqual([
      { bucket_date: "2026-08-01", cost_usd: 7 },
    ]);
  });

  it("returns empty rollups for no rows at all", () => {
    const result = aggregateMonthToDate([], FETCHED_AT, "2026-08-01");

    expect(result).toEqual({
      orgMtd: {
        billed_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        as_of: null,
      },
      orgByModel: [],
      orgDaily: [],
    });
  });
});
