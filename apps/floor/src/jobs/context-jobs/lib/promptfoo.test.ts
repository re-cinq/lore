import { describe, it, expect } from "vitest";
import { parsePromptfooStats } from "./promptfoo.js";

describe("parsePromptfooStats", () => {
  it("reads stats at the document root", () => {
    expect(parsePromptfooStats(JSON.stringify({ stats: { passRate: 0.8, passes: 4, total: 5 } }))).toEqual({
      passRate: 0.8,
      passes: 4,
      total: 5,
    });
  });

  it("reads stats nested under results", () => {
    expect(parsePromptfooStats(JSON.stringify({ results: { stats: { passRate: 0.5 } } }))).toEqual({
      passRate: 0.5,
      passes: null,
      total: null,
    });
  });

  it("returns null when neither location has a numeric passRate", () => {
    expect(parsePromptfooStats(JSON.stringify({ results: {} }))).toBeNull();
  });

  it("returns null on non-JSON output", () => {
    expect(parsePromptfooStats("not json")).toBeNull();
  });

  it("preserves a 0 passRate (all failed) rather than treating it as missing", () => {
    expect(parsePromptfooStats(JSON.stringify({ stats: { passRate: 0, passes: 0, total: 3 } }))).toEqual({
      passRate: 0,
      passes: 0,
      total: 3,
    });
  });
});
