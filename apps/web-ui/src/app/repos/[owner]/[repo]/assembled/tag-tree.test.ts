import { describe, it, expect } from "vitest";
import { buildTagTree } from "./tag-tree";
import type { AssemblyTrace } from "./trace-types";

const trace: AssemblyTrace = {
  query: "add auth",
  template: "implementation",
  effectiveBudget: 8000,
  crossRepo: false,
  templateSections: [],
  sections: [
    {
      header: "Architecture Decisions",
      source: "adrs",
      priority: 1,
      status: "ok",
      allocatedBudget: 3000,
      rawTokens: 10,
      finalTokens: 10,
      truncated: true,
      included: true,
      items: [
        {
          text: "a",
          tokens: 5,
          source_path: "adrs/A.md",
          content_type: "adr",
          score: 0.5,
        },
        { text: "b", tokens: 5, source_path: "adrs/B.md", content_type: "adr" },
      ],
    },
    {
      header: "Directory Rules",
      source: "rules",
      priority: 1,
      status: "no-match",
      allocatedBudget: 0,
      rawTokens: 0,
      finalTokens: 0,
      truncated: false,
      included: false,
      items: [],
    },
  ],
  budget: { total: 8000, used: 10, leftover: 7990 },
  freshness: { state: "fresh", message: "" },
  timingsMs: { total: 1, perSource: {} },
};

describe("buildTagTree", () => {
  it("nests context → section → document and drops omitted sections", () => {
    const root = buildTagTree(trace);

    expect(root.tag).toBe("context");
    expect(root.attrs).toContainEqual(["budget", "8000"]);
    // only the included section appears
    expect(root.children).toHaveLength(1);
    expect(root.children![0].tag).toBe("section");
    expect(root.children![0].children).toHaveLength(2);
  });

  it("renders document provenance as attributes and marks only the last as truncated", () => {
    const section = buildTagTree(trace).children![0];
    const [first, last] = section.children!;

    expect(first.attrs).toContainEqual(["relevance", "0.50"]);
    expect(first.attrs.some(([k]) => k === "truncated")).toBe(false);
    expect(last.attrs).toContainEqual(["truncated", "true"]);
    expect(first.content).toBe("a");
  });
});
