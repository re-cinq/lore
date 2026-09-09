import { describe, it, expect } from "vitest";
import { extractImportedCallSites } from "./reference-extractor.js";

describe("extractImportedCallSites", () => {
  // specs/spec-traceability-graph/data-model.md#call-graph-extractor
  it("returns imported symbol names and their source paths when those symbols are called in a TypeScript source file", async () => {
    const source = [
      'import { nextTransition } from "./transition.js";',
      'import { selectEdge } from "../edges.js";',
      "",
      "function advance(state: State) {",
      "  const edge = selectEdge(state);",
      "  return nextTransition(state, edge);",
      "}",
    ].join("\n");

    const sites = await extractImportedCallSites(".ts", source);

    expect(sites).toContainEqual({
      name: "nextTransition",
      fromPath: "./transition.js",
    });
    expect(sites).toContainEqual({
      name: "selectEdge",
      fromPath: "../edges.js",
    });
  });

  it("omits imported symbols that are never called in the file", async () => {
    const source = [
      'import { unused } from "./util.js";',
      'import { used } from "./other.js";',
      "",
      "function run() { return used(); }",
    ].join("\n");

    const sites = await extractImportedCallSites(".ts", source);

    const names = sites.map((s) => s.name);

    expect(names).not.toContain("unused");
    expect(names).toContain("used");
  });

  it("returns an empty array for a file with no import declarations", async () => {
    const source = "function greet() { return 'hello'; }";

    const sites = await extractImportedCallSites(".ts", source);

    expect(sites).toEqual([]);
  });
});
