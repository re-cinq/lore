import { describe, it, expect } from "vitest";
import {
  codeFileItems,
  codeFileTombstones,
  type CodeDefinition,
} from "./code-statements.js";
import { attribute, fitsOneItem, relation } from "../statements.js";

const BLOB = "https://github.com/re-cinq/lore/blob/HEAD";
const FILE = "re-cinq/lore:src/x/b.ts";
const ADVANCE = "re-cinq/lore:src/x/b.ts#advance";
const STEP = "re-cinq/lore:src/x/b.ts#step";

const symbol = (
  name: string,
  startLine: number,
  endLine: number,
  rest: Partial<CodeDefinition> = {},
): CodeDefinition => ({
  name,
  kind: "function",
  exported: false,
  anchorHash: null,
  extends: [],
  implements: [],
  startLine,
  endLine,
  calls: [],
  ...rest,
});

const build = (
  symbols: Parameters<typeof codeFileItems>[0]["symbols"],
  imports: Parameters<typeof codeFileItems>[0]["imports"] = [],
) =>
  codeFileItems({
    repo: "re-cinq/lore",
    path: "src/x/b.ts",
    symbols,
    imports,
  });

const relationsOf = (pushed: ReturnType<typeof build>, phrase: string) =>
  pushed.flatMap((part) => part.s.filter((row) => row[2] === phrase));

describe("codeFileItems", () => {
  it("returns one code:src/x/b.ts item where the file defines advance and step with their lines and permalinks, advance referencing step", () => {
    const pushed = build([
      symbol("advance", 3, 9, { calls: ["step", "advance"] }),
      symbol("step", 11, 14),
    ]);

    expect(pushed).toEqual([
      {
        externalId: "code:src/x/b.ts",
        e: [
          ["re-cinq/lore", "Repository", true],
          [FILE, "SourceFile", true],
          [ADVANCE, "CodeDefinition", true],
          [STEP, "CodeDefinition", true],
        ],
        s: [
          relation("re-cinq/lore", "contains", FILE),
          attribute(FILE, "path", "src/x/b.ts"),
          attribute(FILE, "known_as", "b.ts"),
          attribute(FILE, "known_as", "src/x/b.ts"),
          attribute(FILE, "permalink", `${BLOB}/src/x/b.ts`),
          relation(FILE, "defines", ADVANCE),
          attribute(ADVANCE, "symbol", "advance"),
          attribute(ADVANCE, "known_as", "advance"),
          attribute(ADVANCE, "kind", "function"),
          attribute(ADVANCE, "exported", "false"),
          attribute(ADVANCE, "line_start", "3"),
          attribute(ADVANCE, "line_end", "9"),
          attribute(ADVANCE, "permalink", `${BLOB}/src/x/b.ts#L3-L9`),
          relation(ADVANCE, "references", STEP),
          relation(FILE, "defines", STEP),
          attribute(STEP, "symbol", "step"),
          attribute(STEP, "known_as", "step"),
          attribute(STEP, "kind", "function"),
          attribute(STEP, "exported", "false"),
          attribute(STEP, "line_start", "11"),
          attribute(STEP, "line_end", "14"),
          attribute(STEP, "permalink", `${BLOB}/src/x/b.ts#L11-L14`),
        ],
      },
    ]);
  });

  it("returns known_as advance for the definition and known_as b.ts and src/x/b.ts for the file when b.ts defines advance", () => {
    const pushed = build([symbol("advance", 3, 9)]);

    expect(relationsOf(pushed, "known_as")).toEqual([
      attribute(FILE, "known_as", "b.ts"),
      attribute(FILE, "known_as", "src/x/b.ts"),
      attribute(ADVANCE, "known_as", "advance"),
    ]);
  });

  it("returns one known_as index.ts equal to the path when the file sits at the repo root", () => {
    const [rootFileItem] = codeFileItems({
      repo: "re-cinq/lore",
      path: "index.ts",
      symbols: [],
      imports: [],
    });

    expect(relationsOf([rootFileItem], "known_as")).toEqual([
      attribute("re-cinq/lore:index.ts", "known_as", "index.ts"),
    ]);
  });

  it("returns imports src/lib/a.ts and advance references src/lib/a.ts#load when b.ts calls load from ../lib/a.js", () => {
    const pushed = build(
      [symbol("advance", 3, 9, { calls: ["load"] })],
      [{ local: "load", imported: "load", fromPath: "../lib/a.js" }],
    );

    expect({
      imports: relationsOf(pushed, "imports"),
      references: relationsOf(pushed, "references"),
    }).toEqual({
      imports: [relation(FILE, "imports", "re-cinq/lore:src/lib/a.ts")],
      references: [
        relation(ADVANCE, "references", "re-cinq/lore:src/lib/a.ts#load"),
      ],
    });
  });

  it("returns no imports and no references when advance calls parse from the zod package", () => {
    const pushed = build(
      [symbol("advance", 3, 9, { calls: ["parse"] })],
      [{ local: "parse", imported: "parse", fromPath: "zod" }],
    );

    expect({
      imports: relationsOf(pushed, "imports"),
      references: relationsOf(pushed, "references"),
    }).toEqual({ imports: [], references: [] });
  });

  it("splits a file with 40 definitions into items under 200 statements, the first keeping code:<path>", () => {
    const pushed = build(
      Array.from({ length: 40 }, (_, i) =>
        symbol(`step${i}`, i * 3 + 1, i * 3 + 2),
      ),
    );

    expect({
      ids: pushed.map((part) => part.externalId),
      fits: pushed.map(fitsOneItem),
      definitions: relationsOf(pushed, "defines").length,
    }).toEqual({
      ids: ["code:src/x/b.ts", "code:src/x/b.ts.2"],
      fits: [true, true],
      definitions: 40,
    });
  });
});

describe("codeFileItems with a class", () => {
  const RUNNER = "re-cinq/lore:src/x/b.ts#Runner";
  const RUNNER_STEP = "re-cinq/lore:src/x/b.ts#Runner.step";
  const runner = symbol("Runner", 1, 7, {
    kind: "class",
    exported: true,
    anchorHash: "1e7912b3",
  });
  const runnerStep = symbol("Runner.step", 3, 3, {
    kind: "method",
    exported: true,
    container: "Runner",
    anchorHash: "ab12cd34",
  });

  it("defines Runner, contains Runner.step under Runner, and states kind, exported, anchor_hash and lines on each", () => {
    expect(build([runner, runnerStep])).toEqual([
      {
        externalId: "code:src/x/b.ts",
        e: [
          ["re-cinq/lore", "Repository", true],
          [FILE, "SourceFile", true],
          [RUNNER, "CodeDefinition", true],
          [RUNNER_STEP, "CodeDefinition", true],
        ],
        s: [
          relation("re-cinq/lore", "contains", FILE),
          attribute(FILE, "path", "src/x/b.ts"),
          attribute(FILE, "known_as", "b.ts"),
          attribute(FILE, "known_as", "src/x/b.ts"),
          attribute(FILE, "permalink", `${BLOB}/src/x/b.ts`),
          relation(FILE, "defines", RUNNER),
          attribute(RUNNER, "symbol", "Runner"),
          attribute(RUNNER, "known_as", "Runner"),
          attribute(RUNNER, "kind", "class"),
          attribute(RUNNER, "exported", "true"),
          attribute(RUNNER, "anchor_hash", "1e7912b3"),
          attribute(RUNNER, "line_start", "1"),
          attribute(RUNNER, "line_end", "7"),
          attribute(RUNNER, "permalink", `${BLOB}/src/x/b.ts#L1-L7`),
          relation(FILE, "defines", RUNNER_STEP),
          attribute(RUNNER_STEP, "symbol", "Runner.step"),
          attribute(RUNNER_STEP, "known_as", "step"),
          attribute(RUNNER_STEP, "kind", "method"),
          attribute(RUNNER_STEP, "exported", "true"),
          attribute(RUNNER_STEP, "anchor_hash", "ab12cd34"),
          attribute(RUNNER_STEP, "line_start", "3"),
          attribute(RUNNER_STEP, "line_end", "3"),
          attribute(RUNNER_STEP, "permalink", `${BLOB}/src/x/b.ts#L3-L3`),
          relation(RUNNER, "contains", RUNNER_STEP),
        ],
      },
    ]);
  });

  it("extends src/x/base.ts#Base when Base is imported from ./base.js and drops a package type", () => {
    const pushed = build(
      [
        symbol("Runner", 1, 7, {
          kind: "class",
          extends: ["Base"],
          implements: ["Step", "Loggable"],
        }),
      ],
      [
        { local: "Base", imported: "Base", fromPath: "./base.js" },
        { local: "Loggable", imported: "Loggable", fromPath: "pino" },
      ],
    );

    expect({
      extends: relationsOf(pushed, "extends"),
      implements: relationsOf(pushed, "implements"),
      definitions: pushed[0].e.filter(([, kind]) => kind === "CodeDefinition"),
    }).toEqual({
      extends: [relation(RUNNER, "extends", "re-cinq/lore:src/x/base.ts#Base")],
      implements: [],
      definitions: [
        [RUNNER, "CodeDefinition", true],
        ["re-cinq/lore:src/x/base.ts#Base", "CodeDefinition", true],
      ],
    });
  });

  it("knows a method as step only when no sibling definition is named step", () => {
    const pushed = build([runner, runnerStep, symbol("step", 9, 11)]);

    expect(relationsOf(pushed, "known_as")).toEqual([
      attribute(FILE, "known_as", "b.ts"),
      attribute(FILE, "known_as", "src/x/b.ts"),
      attribute(RUNNER, "known_as", "Runner"),
      attribute(STEP, "known_as", "step"),
    ]);
  });
});

describe("codeFileTombstones", () => {
  it("returns code:<path> tombstones for deleted source files", () => {
    expect(codeFileTombstones(["src/a.ts", "src/b.ts"])).toEqual([
      { externalId: "code:src/a.ts", deleted: true },
      { externalId: "code:src/b.ts", deleted: true },
    ]);
  });
});

describe("codeFileItems with symbols that differ only by case", () => {
  it("returns one CodeDefinition and both symbols for SourceChips and sourceChips", () => {
    const [folded] = build([
      symbol("SourceChips", 3, 9),
      symbol("sourceChips", 11, 14),
    ]);

    expect({
      definitions: folded.e.filter(([, kind]) => kind === "CodeDefinition"),
      symbols: folded.s
        .filter((row) => row[2] === "symbol")
        .map((row) => row[4]),
    }).toEqual({
      definitions: [
        ["re-cinq/lore:src/x/b.ts#SourceChips", "CodeDefinition", true],
      ],
      symbols: ["SourceChips", "sourceChips"],
    });
  });
});
