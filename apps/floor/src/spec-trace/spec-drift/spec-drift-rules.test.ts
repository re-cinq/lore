import { describe, it, expect } from "vitest";
import type { TraceDocument } from "@re-cinq/lore-shared";
import {
  isAssertionSource,
  shouldSkipDrift,
  decideGraphDrift,
  decideHeuristicDrift,
} from "./spec-drift-rules.js";

function traceDoc(statements: TraceDocument["statements"], sections: TraceDocument["sections"] = []): TraceDocument {
  return {
    filePath: "specs/api-routes/healthz/spec.md",
    title: "GET /healthz",
    description: "",
    sections,
    statements,
    coverage: { testable: 0, covered: 0, untestable: 0, ratio: 0 },
  };
}

function stmt(over: Partial<TraceDocument["statements"][number]>): TraceDocument["statements"][number] {
  return { uid: "0x1", ordinal: 1, text: "a statement", state: "tested", links: [], ...over };
}

describe("isAssertionSource", () => {
  it("excludes research docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/research.md")).toBe(false);
  });

  it("excludes plan docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/plan.md")).toBe(false);
  });

  it("excludes tasks docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/tasks.md")).toBe(false);
  });

  it("excludes quickstart docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/quickstart.md")).toBe(false);
  });

  it("is case-insensitive about the excluded basename", () => {
    expect(isAssertionSource("specs/X/RESEARCH.md")).toBe(false);
  });

  it("includes spec docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/spec.md")).toBe(true);
  });

  it("includes data-model docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/data-model.md")).toBe(true);
  });

  it("matches on the basename, not a parent directory named research", () => {
    expect(isAssertionSource("research/spec.md")).toBe(true);
  });

  it("treats a trailing-slash path as a non-excluded source", () => {
    expect(isAssertionSource("specs/foo/")).toBe(true);
  });
});

describe("shouldSkipDrift", () => {
  const now = new Date("2026-06-01T10:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000).toISOString();

  it("creates a task when none exists", () => {
    expect(shouldSkipDrift([], now)).toBe(false);
  });

  it("skips when an open PR task already exists, regardless of age", () => {
    expect(shouldSkipDrift([{ status: "pr-created", created_at: daysAgo(100) }], now)).toBe(true);
  });

  it("skips when a task is awaiting review", () => {
    expect(shouldSkipDrift([{ status: "review", created_at: daysAgo(40) }], now)).toBe(true);
  });

  it("skips a recently failed task within the short failed cooldown", () => {
    expect(shouldSkipDrift([{ status: "failed", created_at: daysAgo(1) }], now)).toBe(true);
  });

  it("allows refiling once a failed task is past the short failed cooldown", () => {
    expect(shouldSkipDrift([{ status: "failed", created_at: daysAgo(3) }], now)).toBe(false);
  });

  it("skips a recently merged task within the cooldown", () => {
    expect(shouldSkipDrift([{ status: "merged", created_at: daysAgo(2) }], now)).toBe(true);
  });

  it("allows refiling once a merged task is past the cooldown", () => {
    expect(shouldSkipDrift([{ status: "merged", created_at: daysAgo(100) }], now)).toBe(false);
  });

  it("allows refiling after an old cancelled task", () => {
    expect(shouldSkipDrift([{ status: "cancelled", created_at: daysAgo(100) }], now)).toBe(false);
  });
});

describe("decideGraphDrift", () => {
  it("reports no graph data when the document has no statements", () => {
    const d = decideGraphDrift(traceDoc([]));
    expect(d).toMatchObject({ available: false, drifted: false });
    expect(d.statements).toEqual([]);
  });

  it("is clean when every statement is satisfied (the healthz case)", () => {
    const doc = traceDoc([
      stmt({ ordinal: 1, violated: false, drifted: false }),
      stmt({ uid: "0x2", ordinal: 2, violated: false }),
    ]);
    expect(decideGraphDrift(doc)).toMatchObject({ available: true, drifted: false });
  });

  it("flags a violated statement with its section heading and reason", () => {
    const doc = traceDoc(
      [stmt({ uid: "0x9", ordinal: 4, text: "503 when DB down", violated: true, sectionUid: "0xs1" })],
      [{ uid: "0xs1", heading: "Behavior", ordinal: 1 }],
    );
    const d = decideGraphDrift(doc);
    expect(d).toMatchObject({ available: true, drifted: true });
    expect(d.statements[0]).toMatchObject({ text: "503 when DB down", reason: "violated", section: "Behavior" });
  });

  it("flags a drifted statement", () => {
    const d = decideGraphDrift(traceDoc([stmt({ drifted: true })]));
    expect(d.drifted).toBe(true);
    expect(d.statements[0]?.reason).toBe("drifted");
  });
});

describe("decideHeuristicDrift", () => {
  const fn = (name: string) => ({ name, kind: "function", description: "" });

  it("flags drift when at least 3 scorable symbols are missing past the threshold", () => {
    const assertions = [fn("a"), fn("b"), fn("c"), fn("present")];
    const known = new Set(["present"]);
    expect(decideHeuristicDrift(assertions, known)).toMatchObject({ drifted: true });
  });

  it("does not flag drift when fewer than 3 symbols are missing", () => {
    const assertions = [fn("a"), fn("present1"), fn("present2"), fn("present3")];
    const known = new Set(["present1", "present2", "present3"]);
    expect(decideHeuristicDrift(assertions, known).drifted).toBe(false);
  });

  it("ignores endpoint and other kinds that are not top-level symbols", () => {
    const assertions = [
      { name: "GET /healthz", kind: "endpoint", description: "" },
      { name: "status field", kind: "other", description: "" },
    ];
    const d = decideHeuristicDrift(assertions, new Set());
    expect(d).toMatchObject({ drifted: false, scored: 0 });
  });
});
