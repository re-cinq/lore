import { describe, it, expect } from "vitest";
import { parseRangesFacet } from "./coverage-ranges.js";

describe("parseRangesFacet", () => {
  it("returns one interval per comma-separated range", () => {
    expect(parseRangesFacet("12-18,30-40")).toEqual([
      { startLine: 12, endLine: 18 },
      { startLine: 30, endLine: 40 },
    ]);
  });

  it("returns a single-line interval for a bare line number", () => {
    expect(parseRangesFacet("5")).toEqual([{ startLine: 5, endLine: 5 }]);
  });

  it("trims whitespace around ranges and bounds", () => {
    expect(parseRangesFacet("  12-18 , 30 - 40 ")).toEqual([
      { startLine: 12, endLine: 18 },
      { startLine: 30, endLine: 40 },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseRangesFacet("")).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseRangesFacet(undefined)).toEqual([]);
  });

  it("skips non-numeric garbage segments", () => {
    expect(parseRangesFacet("10-20,foo,30")).toEqual([
      { startLine: 10, endLine: 20 },
      { startLine: 30, endLine: 30 },
    ]);
  });
});
