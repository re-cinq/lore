import { describe, it, expect } from "vitest";
import { parseCodeChunks } from "../parse-code-chunks.js";

describe("parseCodeChunks", () => {
  it("returns one chunk per top-level function with 1-based line range and symbol_type", () => {
    const source = ["export function add(a: number, b: number): number {", "  return a + b;", "}"].join("\n");
    expect(parseCodeChunks("shared/src/math.ts", source)).toMatchObject([
      { symbol_name: "add", symbol_type: "function", start_line: 1, end_line: 3 },
    ]);
  });

  it("describes class, interface, type, enum, and const declarations across the file", () => {
    const source = [
      "interface Shape { area(): number; }", // 1
      "type Id = string;", // 2
      "enum Color { Red, Blue }", // 3
      "class Circle { r = 1; }", // 4
      "export const PI = 3.14;", // 5
    ].join("\n");
    expect(parseCodeChunks("shared/src/shapes.ts", source)).toMatchObject([
      { symbol_name: "Shape", symbol_type: "interface", start_line: 1, end_line: 1 },
      { symbol_name: "Id", symbol_type: "type", start_line: 2, end_line: 2 },
      { symbol_name: "Color", symbol_type: "enum", start_line: 3, end_line: 3 },
      { symbol_name: "Circle", symbol_type: "class", start_line: 4, end_line: 4 },
      { symbol_name: "PI", symbol_type: "variable", start_line: 5, end_line: 5 },
    ]);
  });

  it("skips imports and bare expressions, hashing only the symbol body", () => {
    const source = ['import { x } from "./x.js";', "console.log(x);", "export function go() {}"].join("\n");
    const chunks = parseCodeChunks("shared/src/go.ts", source);
    expect(chunks).toMatchObject([{ symbol_name: "go", symbol_type: "function" }]);
    expect(chunks[0]?.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
