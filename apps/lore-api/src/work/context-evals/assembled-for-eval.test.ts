import { describe, it, expect } from "vitest";
import type { AssemblyTrace } from "@re-cinq/lore-shared/project/knowledge/context-assembly.js";
import { sourcesOf } from "./assembled-for-eval.js";

type Section = AssemblyTrace["sections"][number];

function section(over: Partial<Section>): Section {
  return {
    header: "Architecture Decisions",
    source: "adrs",
    priority: 2,
    status: "ok",
    allocatedBudget: 2000,
    rawTokens: 500,
    finalTokens: 500,
    truncated: false,
    included: true,
    items: [],
    ...over,
  };
}

const trace = (sections: Section[]) => ({ sections }) as AssemblyTrace;

describe("sourcesOf", () => {
  it("lists the path and tokens of every item in an included section", () => {
    expect(
      sourcesOf(
        trace([
          section({
            items: [
              { text: "a", tokens: 400, source_path: "adrs/ADR-032.md" },
              { text: "b", tokens: 100, source_path: "adrs/ADR-044.md" },
            ],
          }),
        ]),
      ),
    ).toEqual([
      { path: "adrs/ADR-032.md", tokens: 400 },
      { path: "adrs/ADR-044.md", tokens: 100 },
    ]);
  });

  it("leaves out the items of a section the budget dropped", () => {
    expect(
      sourcesOf(
        trace([
          section({
            included: false,
            items: [{ text: "a", tokens: 400, source_path: "a.ts" }],
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it("counts an item with no path under an empty path, so its tokens still weigh on the total", () => {
    expect(
      sourcesOf(trace([section({ items: [{ text: "graph", tokens: 30 }] })])),
    ).toEqual([{ path: "", tokens: 30 }]);
  });

  it("returns no sources when the assembly carried no trace", () => {
    expect(sourcesOf(undefined)).toEqual([]);
  });
});
