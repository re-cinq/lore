import { describe, it, expect } from "vitest";
import {
  extractCodeSymbols,
  extractImportedCallSites,
} from "./reference-extractor.js";

describe("extractImportedCallSites", () => {
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

describe("extractCodeSymbols", () => {
  const source = [
    'import { nextTransition as next } from "./transition.js";',
    'import { map } from "lodash";',
    "",
    "function helper() {",
    "  return map([], String);",
    "}",
    "",
    "export const advance = (state: number) => {",
    "  helper();",
    "  return next(state);",
    "};",
    "",
    "export class Runner {",
    "  run() { return advance(1); }",
    "}",
  ].join("\n");

  it("returns helper, advance and Runner with their line ranges and the identifiers each calls", async () => {
    const { symbols } = await extractCodeSymbols(".ts", source);

    expect(
      symbols.map(({ name, startLine, endLine, calls }) => ({
        name,
        startLine,
        endLine,
        calls,
      })),
    ).toEqual([
      { name: "helper", startLine: 4, endLine: 6, calls: ["map"] },
      { name: "advance", startLine: 8, endLine: 11, calls: ["helper", "next"] },
      { name: "Runner", startLine: 13, endLine: 15, calls: ["advance"] },
    ]);
  });

  it("maps the local name next to nextTransition imported from ./transition.js", async () => {
    const { imports } = await extractCodeSymbols(".ts", source);

    expect(imports).toEqual([
      {
        local: "next",
        imported: "nextTransition",
        fromPath: "./transition.js",
      },
      { local: "map", imported: "map", fromPath: "lodash" },
    ]);
  });

  it("returns no symbols for an unsupported .py file", async () => {
    const parsed = await extractCodeSymbols(".py", "def f(): pass");

    expect(parsed).toEqual({ symbols: [], imports: [] });
  });
});
