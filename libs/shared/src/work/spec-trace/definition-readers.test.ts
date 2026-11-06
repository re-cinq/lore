import { describe, it, expect } from "vitest";
import { extractCodeSymbols } from "./reference-extractor.js";
import { anchorHashOf } from "../../domain/anchor-hash.js";

describe("definition readers", () => {
  const source = [
    "export class Runner extends Base implements Step, Loggable {",
    "  constructor() {}",
    "  step() {}",
    "  get g() { return 1; }",
    "  set g(v: number) {}",
    "  static make() { return helper(); }",
    "}",
    "interface I extends J {}",
    "type T = string;",
    "enum E {}",
    "function helper() {}",
  ].join("\n");

  const named = async (name: string) => {
    const { symbols } = await extractCodeSymbols(".ts", source);
    const found = symbols.filter((candidate) => candidate.name === name);

    expect(found).toHaveLength(1);
    const { text: _text, ...rest } = found[0];

    return rest;
  };

  it("reads a class, its methods as Runner.step, Runner.g and Runner.make with kind method and container Runner, and its heritage Base, Step and Loggable", async () => {
    const { symbols } = await extractCodeSymbols(".ts", source);
    const method = (name: string, line: number, calls: string[]) => ({
      name: `Runner.${name}`,
      kind: "method",
      container: "Runner",
      exported: true,
      startLine: line,
      endLine: line,
      calls,
    });

    expect(
      symbols
        .filter((symbol) => symbol.name.startsWith("Runner"))
        .map(({ text: _text, anchorHash: _hash, ...rest }) => rest),
    ).toEqual([
      {
        name: "Runner",
        kind: "class",
        exported: true,
        extends: ["Base"],
        implements: ["Step", "Loggable"],
        startLine: 1,
        endLine: 7,
        calls: ["helper"],
      },
      { ...method("step", 3, []), extends: [], implements: [] },
      { ...method("g", 4, []), extends: [], implements: [] },
      { ...method("make", 6, ["helper"]), extends: [], implements: [] },
    ]);
  });

  it("reads interface I extending J, type T and enum E with their kinds and lines", async () => {
    const { symbols } = await extractCodeSymbols(".ts", source);

    expect(
      symbols
        .filter((symbol) => ["I", "T", "E"].includes(symbol.name))
        .map(({ name, kind, startLine, endLine, extends: parents }) => ({
          name,
          kind,
          startLine,
          endLine,
          extends: parents,
        })),
    ).toEqual([
      {
        name: "I",
        kind: "interface",
        startLine: 8,
        endLine: 8,
        extends: ["J"],
      },
      { name: "T", kind: "type", startLine: 9, endLine: 9, extends: [] },
      { name: "E", kind: "enum", startLine: 10, endLine: 10, extends: [] },
    ]);
  });

  it("marks exported true for the export statement and false for the bare helper", async () => {
    expect({
      runner: (await named("Runner")).exported,
      helper: await named("helper"),
    }).toEqual({
      runner: true,
      helper: {
        name: "helper",
        kind: "function",
        exported: false,
        anchorHash: anchorHashOf("function helper() {}"),
        extends: [],
        implements: [],
        startLine: 11,
        endLine: 11,
        calls: [],
      },
    });
  });

  it("hashes the declaration line so anchorHash equals anchorHashOf of that line", async () => {
    expect({
      runner: (await named("Runner")).anchorHash,
      make: (await named("Runner.make")).anchorHash,
      step: (await named("Runner.step")).anchorHash,
    }).toEqual({
      runner: anchorHashOf(
        "export class Runner extends Base implements Step, Loggable {",
      ),
      make: anchorHashOf("  static make() { return helper(); }"),
      step: null,
    });
  });

  it("yields nothing for export default class without a name", async () => {
    const { symbols } = await extractCodeSymbols(
      ".ts",
      "export default class {\n  run() {}\n}",
    );

    expect(symbols).toEqual([]);
  });
});
