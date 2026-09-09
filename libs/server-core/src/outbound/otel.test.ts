import { describe, it, expect } from "vitest";

import { isGapCandidate } from "./otel.js";

describe("isGapCandidate", () => {
  it("returns true when score below the 0.72 threshold", () => {
    expect(isGapCandidate(0.5)).toBe(true);
  });

  it("returns false when score at the 0.72 boundary", () => {
    expect(isGapCandidate(0.72)).toBe(false);
  });

  it("returns false when score above the 0.72 threshold", () => {
    expect(isGapCandidate(0.9)).toBe(false);
  });
});
