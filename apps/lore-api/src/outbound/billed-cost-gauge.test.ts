import { describe, expect, it } from "vitest";
import { billedObservations } from "./billed-cost-gauge.js";

describe("billedObservations", () => {
  it("turns one anthropic row of 1.5 today and 20 this month into a day point and a month point", () => {
    expect(
      billedObservations([
        {
          vendor: "anthropic",
          item: "claude-sonnet-4-5",
          dayUsd: 1.5,
          monthUsd: 20,
        },
      ]),
    ).toEqual([
      {
        value: 1.5,
        attributes: {
          vendor: "anthropic",
          item: "claude-sonnet-4-5",
          window: "day",
        },
      },
      {
        value: 20,
        attributes: {
          vendor: "anthropic",
          item: "claude-sonnet-4-5",
          window: "month",
        },
      },
    ]);
  });
});
