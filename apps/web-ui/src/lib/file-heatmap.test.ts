import { describe, it, expect } from "vitest";
import {
  touchKind,
  aggregateFileTouches,
  hiddenTouchCount,
  stripWorkspacePrefix,
  truncateMiddle,
  type TouchCounts,
} from "./file-heatmap";

describe("touchKind", () => {
  it.each([
    ["Read", "read"],
    ["Grep", "read"],
    ["Glob", "read"],
  ])("classifies %s as a read", (tool, kind) => {
    expect(touchKind(tool)).toBe(kind);
  });

  it.each([
    ["Edit", "write"],
    ["Write", "write"],
    ["NotebookEdit", "write"],
  ])("classifies %s as a write", (tool, kind) => {
    expect(touchKind(tool)).toBe(kind);
  });

  it.each([["Bash"], ["MultiEdit"], ["WebFetch"], ["mcp__lore"]])(
    "classifies %s as null",
    (tool) => {
      expect(touchKind(tool)).toBeNull();
    },
  );

  it("classifies a null tool as null", () => {
    expect(touchKind(null)).toBeNull();
  });
});

const counts = (reads: number, writes: number): TouchCounts => ({
  reads,
  writes,
});

describe("aggregateFileTouches", () => {
  it("sorts file touches by total descending", () => {
    const ranked = aggregateFileTouches({
      "src/a.ts": counts(1, 0),
      "src/b.ts": counts(2, 1),
      "src/c.ts": counts(0, 2),
    });

    expect(ranked.map((t) => t.path)).toEqual([
      "src/b.ts",
      "src/c.ts",
      "src/a.ts",
    ]);
  });

  it("breaks a total tie by path so the order is deterministic", () => {
    const ranked = aggregateFileTouches({
      "src/b.ts": counts(1, 0),
      "src/a.ts": counts(1, 0),
    });

    expect(ranked.map((t) => t.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("reports reads, writes and total for each file", () => {
    const [busiest] = aggregateFileTouches({ "src/a.ts": counts(3, 1) });

    expect(busiest).toEqual({
      path: "src/a.ts",
      reads: 3,
      writes: 1,
      total: 4,
      weight: 1,
    });
  });

  it("normalizes weight to the busiest file at 1", () => {
    const ranked = aggregateFileTouches({
      "src/a.ts": counts(0, 4),
      "src/b.ts": counts(0, 1),
    });

    expect(ranked.map((t) => t.weight)).toEqual([1, 0.25]);
  });

  it("cuts the ranking to topN when more files exist", () => {
    const ranked = aggregateFileTouches(
      {
        "src/a.ts": counts(0, 3),
        "src/b.ts": counts(0, 2),
        "src/c.ts": counts(0, 1),
      },
      2,
    );

    expect(ranked.map((t) => t.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns an empty ranking for no file touches", () => {
    expect(aggregateFileTouches({})).toEqual([]);
  });
});

describe("hiddenTouchCount", () => {
  it("counts the files hidden beyond topN", () => {
    expect(
      hiddenTouchCount(
        { a: counts(1, 0), b: counts(1, 0), c: counts(1, 0) },
        2,
      ),
    ).toBe(1);
  });

  it("returns zero hidden when topN covers every file", () => {
    expect(hiddenTouchCount({ a: counts(1, 0) }, 30)).toBe(0);
  });
});

describe("stripWorkspacePrefix", () => {
  it("strips a leading /workspace/ prefix", () => {
    expect(stripWorkspacePrefix("/workspace/src/a.ts")).toBe("src/a.ts");
  });

  it("returns the path unchanged with no workspace prefix", () => {
    expect(stripWorkspacePrefix("src/a.ts")).toBe("src/a.ts");
  });
});

describe("truncateMiddle", () => {
  it("truncates the middle of a long path keeping head and tail", () => {
    const result = truncateMiddle(
      "packages/very/deeply/nested/module/component.tsx",
      20,
    );

    expect(result).toHaveLength(20);
    expect(result.startsWith("packages")).toBe(true);
    expect(result.endsWith(".tsx")).toBe(true);
    expect(result).toContain("…");
  });

  it("returns a short path unchanged", () => {
    expect(truncateMiddle("src/a.ts", 20)).toBe("src/a.ts");
  });
});
