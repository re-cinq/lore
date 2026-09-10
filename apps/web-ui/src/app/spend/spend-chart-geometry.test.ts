import { describe, it, expect } from "vitest";
import { barHeightFractions, comparePair } from "./spend-chart-geometry";

describe("barHeightFractions", () => {
  it("scales each value against the largest", () => {
    expect(barHeightFractions([1, 2, 4])).toEqual([0.25, 0.5, 1]);
  });

  it("returns zeros when every value is zero", () => {
    expect(barHeightFractions([0, 0])).toEqual([0, 0]);
  });

  it("returns an empty array for no values", () => {
    expect(barHeightFractions([])).toEqual([]);
  });

  it("floors a negative value at zero rather than a negative height", () => {
    expect(barHeightFractions([-5, 10])).toEqual([0, 1]);
  });
});

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
