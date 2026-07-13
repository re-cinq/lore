import { describe, it, expect } from "vitest";
import {
  planTraceUnits,
  runTraceUnits,
  type TraceUnit,
} from "./trace-units.js";

describe("planTraceUnits (pure)", () => {
  it("routes a specs/ markdown path to a spec projection unit", () => {
    expect(planTraceUnits(["specs/foo/spec.md"])).toEqual([
      { filePath: "specs/foo/spec.md", kind: "spec" },
    ]);
  });

  it("routes an adrs/ markdown path to an adr projection unit", () => {
    expect(planTraceUnits(["adrs/ADR-001.md"])).toEqual([
      { filePath: "adrs/ADR-001.md", kind: "adr" },
    ]);
  });

  it("excludes a source file outside the doc seed prefixes", () => {
    expect(planTraceUnits(["src/widget.ts"])).toEqual([]);
  });

  it("excludes a non-markdown file under a seed prefix", () => {
    expect(planTraceUnits(["specs/foo/diagram.png"])).toEqual([]);
  });
});

describe("runTraceUnits (isolation)", () => {
  it("runs siblings and records the failure when one unit's projection throws", async () => {
    const projected: string[] = [];
    const project = async (unit: TraceUnit): Promise<void> => {
      if (unit.filePath === "specs/bad/spec.md")
        throw new Error("projection blew up");
      projected.push(unit.filePath);
    };

    const result = await runTraceUnits(
      [
        { filePath: "specs/bad/spec.md", kind: "spec" },
        { filePath: "specs/good/spec.md", kind: "spec" },
      ],
      project,
    );

    expect(projected).toContain("specs/good/spec.md");
    expect(result).toEqual({
      projected: 1,
      failed: [{ filePath: "specs/bad/spec.md", kind: "spec" }],
    });
  });
});
