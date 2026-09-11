import { describe, it, expect } from "vitest";
import { comparePair } from "./spend-chart-geometry";

describe("comparePair", () => {
  it("scales both values to the larger of the two", () => {
    expect(comparePair(30, 20)).toEqual({
      estimateFraction: 1,
      billedFraction: 20 / 30,
    });
  });

  it("returns zeros when neither side has spend", () => {
    expect(comparePair(0, 0)).toEqual({
      estimateFraction: 0,
      billedFraction: 0,
    });
  });
});
