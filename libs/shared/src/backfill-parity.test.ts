import { describe, it, expect } from "vitest";
import {
  evaluateParityGates,
  jaccard,
  meanTopkJaccard,
} from "./backfill-parity.js";

describe("jaccard", () => {
  it("returns 1 for two identical result sets", () => {
    expect(jaccard(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("returns 0.5 for {a,b,c} vs {a,b,d} (2 shared of 4 total)", () => {
    expect(jaccard(["a", "b", "c"], ["a", "b", "d"])).toBe(0.5);
  });

  it("returns 0 for disjoint result sets", () => {
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("returns 1 for two empty sets (vacuously identical)", () => {
    expect(jaccard([], [])).toBe(1);
  });

  it("treats inputs as sets, deduping repeats", () => {
    expect(jaccard(["a", "a", "b"], ["a", "b"])).toBe(1);
  });
});

describe("meanTopkJaccard", () => {
  it("returns 0.7 for [1, 0.5, 0.6] (sum 2.1 over 3)", () => {
    expect(meanTopkJaccard([1, 0.5, 0.6])).toBeCloseTo(0.7, 10);
  });

  it("returns 0 (not NaN) for an empty sample so the retrieval gate fails loudly", () => {
    expect(meanTopkJaccard([])).toBe(0);
  });
});

describe("evaluateParityGates", () => {
  it("passes with exit 0 when every table count matches and mean jaccard is 0.87", () => {
    const allParity = {
      tables: {
        memories: { pg: 412, dgraph: 412 },
        facts: { pg: 3120, dgraph: 3120 },
      },
      meanTopkJaccard: 0.87,
    };

    expect(evaluateParityGates(allParity)).toEqual({
      passed: true,
      exitCode: 0,
      failures: [],
    });
  });

  it("fails with non-zero exit naming the table when facts count mismatches", () => {
    const factsMismatch = {
      tables: {
        memories: { pg: 412, dgraph: 412 },
        facts: { pg: 3120, dgraph: 3119 },
      },
      meanTopkJaccard: 0.9,
    };

    const result = evaluateParityGates(factsMismatch);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toContain("facts");
  });

  it("fails with non-zero exit naming the jaccard gate when tables match but mean jaccard is 0.5", () => {
    const lowJaccard = {
      tables: {
        memories: { pg: 10, dgraph: 10 },
      },
      meanTopkJaccard: 0.5,
    };

    const result = evaluateParityGates(lowJaccard);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toMatch(/jaccard|retrieval/i);
  });

  it("passes when mean jaccard is exactly the threshold 0.8 (gate is >=)", () => {
    const atThreshold = {
      tables: { memories: { pg: 5, dgraph: 5 } },
      meanTopkJaccard: 0.8,
    };

    expect(evaluateParityGates(atThreshold)).toEqual({
      passed: true,
      exitCode: 0,
      failures: [],
    });
  });

  it("accumulates both a table-mismatch and a jaccard failure when both gates fail", () => {
    const bothFail = {
      tables: {
        memories: { pg: 412, dgraph: 410 },
        facts: { pg: 3120, dgraph: 3120 },
      },
      meanTopkJaccard: 0.4,
    };

    const result = evaluateParityGates(bothFail);

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.join(" ")).toContain("memories");
    expect(result.failures.join(" ")).toMatch(/jaccard|retrieval/i);
  });

  it("fails a jaccard of 0.9 against a stricter custom threshold of 0.95", () => {
    const summary = {
      tables: { memories: { pg: 1, dgraph: 1 } },
      meanTopkJaccard: 0.9,
    };

    const result = evaluateParityGates(summary, 0.95);

    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/jaccard|retrieval/i);
  });
});
