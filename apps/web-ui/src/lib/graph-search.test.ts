import { describe, it, expect } from "vitest";
import { nodeMatchesQuery } from "./graph-search";

describe("nodeMatchesQuery", () => {
  it("matches on a case-insensitive label substring", () => {
    expect(nodeMatchesQuery({ label: "ChunkerService" }, "chunk")).toBe(true);
  });

  it("matches on a path substring when the label does not match", () => {
    expect(
      nodeMatchesQuery(
        { label: "T001", path: "src/lib/chunker.ts" },
        "chunker",
      ),
    ).toBe(true);
  });

  it("returns false when neither label nor path contains the query", () => {
    expect(
      nodeMatchesQuery({ label: "T001", path: "src/lib/tasks.ts" }, "chunker"),
    ).toBe(false);
  });

  it("treats an empty query as matching every node", () => {
    expect(nodeMatchesQuery({ label: "anything" }, "")).toBe(true);
    expect(nodeMatchesQuery({ label: "anything" }, "   ")).toBe(true);
  });

  it("returns false for a node with neither label nor path on a non-empty query", () => {
    expect(nodeMatchesQuery({}, "chunk")).toBe(false);
  });
});
