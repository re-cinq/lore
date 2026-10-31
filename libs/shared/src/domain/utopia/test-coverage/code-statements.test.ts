import { describe, it, expect } from "vitest";
import { codeFileItems, codeFileTombstones } from "./code-statements.js";
import { attribute, fitsOneItem, relation } from "../statements.js";

const BLOB = "https://github.com/re-cinq/lore/blob/HEAD";
const FILE = "re-cinq/lore:src/x/b.ts";
const ADVANCE = "re-cinq/lore:src/x/b.ts#advance";
const STEP = "re-cinq/lore:src/x/b.ts#step";

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
      { name: "advance", startLine: 3, endLine: 9, calls: ["step", "advance"] },
      { name: "step", startLine: 11, endLine: 14, calls: [] },
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
          attribute(ADVANCE, "line_start", "3"),
          attribute(ADVANCE, "line_end", "9"),
          attribute(ADVANCE, "permalink", `${BLOB}/src/x/b.ts#L3-L9`),
          relation(ADVANCE, "references", STEP),
          relation(FILE, "defines", STEP),
          attribute(STEP, "symbol", "step"),
          attribute(STEP, "known_as", "step"),
          attribute(STEP, "line_start", "11"),
          attribute(STEP, "line_end", "14"),
          attribute(STEP, "permalink", `${BLOB}/src/x/b.ts#L11-L14`),
        ],
      },
    ]);
  });

  it("returns known_as advance for the definition and known_as b.ts and src/x/b.ts for the file when b.ts defines advance", () => {
    const pushed = build([
      { name: "advance", startLine: 3, endLine: 9, calls: [] },
    ]);

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
      [{ name: "advance", startLine: 3, endLine: 9, calls: ["load"] }],
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
      [{ name: "advance", startLine: 3, endLine: 9, calls: ["parse"] }],
      [{ local: "parse", imported: "parse", fromPath: "zod" }],
    );

    expect({
      imports: relationsOf(pushed, "imports"),
      references: relationsOf(pushed, "references"),
    }).toEqual({ imports: [], references: [] });
  });

  it("splits a file with 60 definitions into items under 200 statements, the first keeping code:<path>", () => {
    const pushed = build(
      Array.from({ length: 60 }, (_, i) => ({
        name: `step${i}`,
        startLine: i * 3 + 1,
        endLine: i * 3 + 2,
        calls: [],
      })),
    );

    expect({
      ids: pushed.map((part) => part.externalId),
      fits: pushed.map(fitsOneItem),
      definitions: relationsOf(pushed, "defines").length,
    }).toEqual({
      ids: ["code:src/x/b.ts", "code:src/x/b.ts.2"],
      fits: [true, true],
      definitions: 60,
    });
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
