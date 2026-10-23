import { describe, it, expect } from "vitest";
import { statementItems, untitledTestPaths } from "./doc-statements.js";
import {
  attribute,
  fitsOneItem,
  relation,
  type StatementItem,
} from "../statements.js";

const SPEC = [
  "# Feature Specification: Mirror",
  "",
  "| Field  | Value |",
  "| ------ | ----- |",
  "| Status | Draft |",
  "",
  "## Chain",
  "",
  "- FR1 — Every document is pushed. ([validated by pushes the doc item](libs/shared/src/work/utopia/mirror-document.test.ts#L12), [validated by counts created](../../libs/shared/src/work/utopia/mirror-document.test.ts#L30), [impl](libs/shared/src/work/utopia/mirror-document.ts))",
  "- FR2 — Settings decide. ([see ADR](adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md))",
  "",
  "## Chain",
  "",
  "A second section with the same heading.",
  "",
].join("\n");

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const DOC = "re-cinq/lore:specs/mirror/spec.md";
const BLOB = "https://github.com/re-cinq/lore/blob/HEAD";

const build = (content: string, commitTime?: string) =>
  statementItems({
    repo: "re-cinq/lore",
    path: "specs/mirror/spec.md",
    content,
    commit: COMMIT,
    commitTime,
    kind: "spec",
  });

describe("statementItems", () => {
  it("builds a statement item with two validated_by tests, titles taken after validated by, and one implemented_by source file", () => {
    const [fr1] = build(SPEC, "2026-10-15T10:00:00Z");
    const test1 =
      "re-cinq/lore:libs/shared/src/work/utopia/mirror-document.test.ts::pushes the doc item";
    const test2 =
      "re-cinq/lore:libs/shared/src/work/utopia/mirror-document.test.ts::counts created";
    const file = "re-cinq/lore:libs/shared/src/work/utopia/mirror-document.ts";
    const stmt = `${DOC}#s0000`;

    expect(fr1).toEqual({
      externalId: "stmt:specs/mirror/spec.md#0000",
      doc_time: "2026-10-15T10:00:00Z",
      e: [
        [`${DOC}#chain`, "Section", true],
        [stmt, "Statement", true],
        [test1, "Test", true],
        [test2, "Test", true],
        [file, "SourceFile", true],
      ],
      s: [
        relation(`${DOC}#chain`, "contains", stmt),
        attribute(stmt, "line_start", "9"),
        attribute(stmt, "permalink", `${BLOB}/specs/mirror/spec.md#L9`),
        attribute(stmt, "text", "FR1 — Every document is pushed."),
        relation(stmt, "validated_by", test1),
        attribute(test1, "title", "pushes the doc item"),
        attribute(
          test1,
          "path",
          "libs/shared/src/work/utopia/mirror-document.test.ts",
        ),
        attribute(test1, "line_start", "12"),
        attribute(
          test1,
          "permalink",
          `${BLOB}/libs/shared/src/work/utopia/mirror-document.test.ts#L12`,
        ),
        relation(stmt, "validated_by", test2),
        attribute(test2, "title", "counts created"),
        attribute(
          test2,
          "path",
          "libs/shared/src/work/utopia/mirror-document.test.ts",
        ),
        attribute(test2, "line_start", "30"),
        attribute(
          test2,
          "permalink",
          `${BLOB}/libs/shared/src/work/utopia/mirror-document.test.ts#L30`,
        ),
        relation(stmt, "implemented_by", file),
        attribute(
          file,
          "path",
          "libs/shared/src/work/utopia/mirror-document.ts",
        ),
      ],
    });
  });

  it("links a statement to an ADR with decided_by and treats the ADR as no code link", () => {
    const [, fr2] = build(SPEC);
    const adr =
      "re-cinq/lore:adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md";
    const stmt = `${DOC}#s0001`;

    expect(fr2).toEqual({
      externalId: "stmt:specs/mirror/spec.md#0001",
      e: [
        [`${DOC}#chain`, "Section", true],
        [stmt, "Statement", true],
        [adr, "Adr", true],
      ],
      s: [
        relation(`${DOC}#chain`, "contains", stmt),
        attribute(stmt, "line_start", "10"),
        attribute(stmt, "permalink", `${BLOB}/specs/mirror/spec.md#L10`),
        attribute(
          stmt,
          "text",
          "FR2 — Settings decide. ([see ADR](adrs/ADR-052-code-to-spec-graph-mirrored-in-utopia.md))",
        ),
        relation(stmt, "decided_by", adr),
      ],
    });
  });

  it("files the sentence under the second chain section as chain-2 and omits doc_time for an undated commit", () => {
    const pushed = build(SPEC);
    const sentence = pushed[2];

    expect({
      count: pushed.length,
      dated: pushed.filter((candidate) => "doc_time" in candidate).length,
      section: sentence.e[0],
      statement: sentence.s[0],
    }).toEqual({
      count: 3,
      dated: 0,
      section: [`${DOC}#chain-2`, "Section", true],
      statement: relation(`${DOC}#chain-2`, "contains", `${DOC}#s0002`),
    });
  });

  it("files a README's first sentence under its Usage section", () => {
    const [statement] = statementItems({
      repo: "re-cinq/lore",
      path: "README.md",
      content: "# Lore\n\n## Usage\n\n- Run install.sh once per machine.\n",
      commit: COMMIT,
      kind: "doc",
    });

    expect(statement.s[0]).toEqual(
      relation(
        "re-cinq/lore:README.md#usage",
        "contains",
        "re-cinq/lore:README.md#s0000",
      ),
    );
  });

  it("files a statement written before any heading under the Adr document, never a second Document of the same name", () => {
    const [statement] = statementItems({
      repo: "re-cinq/lore",
      path: "adrs/ADR-052.md",
      content: "- D1 — Decided before any heading.\n\n# ADR-052\n",
      commit: COMMIT,
      kind: "adr",
    });

    expect(
      statement?.e.filter(([name]) => name === "re-cinq/lore:adrs/ADR-052.md"),
    ).toEqual([["re-cinq/lore:adrs/ADR-052.md", "Adr", true]]);
  });

  it("splits a statement with 80 test links into four items under 200 statements each that repeat the section and statement entities", () => {
    const links = Array.from(
      { length: 80 },
      (_, i) => `[validated by case ${i}](src/a.test.ts#L${i + 1})`,
    );
    const pushed = build(`## Many\n\n- FR1 — Linked. (${links.join(", ")})\n`);
    const parts = pushed;
    const testsOf = (part: StatementItem) =>
      part.e.filter(([, kind]) => kind === "Test").length;

    expect({
      ids: parts.map((part) => part.externalId),
      fits: parts.map(fitsOneItem),
      heads: parts.map((part) => part.e.slice(0, 2)),
      tests: parts.reduce((sum, part) => sum + testsOf(part), 0),
    }).toEqual({
      ids: [
        "stmt:specs/mirror/spec.md#0000",
        "stmt:specs/mirror/spec.md#0000.2",
        "stmt:specs/mirror/spec.md#0000.3",
        "stmt:specs/mirror/spec.md#0000.4",
      ],
      fits: [true, true, true, true],
      heads: parts.map(() => [
        [`${DOC}#many`, "Section", true],
        [`${DOC}#s0000`, "Statement", true],
      ]),
      tests: 80,
    });
  });

  it("gives the statement the text FR1 — Spaced words. with its coverage links stripped and its runs of spaces collapsed", () => {
    const [fr1] = build(
      "## Words\n\n- FR1 —   Spaced \t words.  ([validated by a](src/a.test.ts#L1), [b](src/b.ts))\n",
    );

    expect(textsOf(fr1)).toEqual(["FR1 — Spaced words."]);
  });

  it("cuts a 5,003-character statement to its first 4,000 characters and an ellipsis", () => {
    const words = "words ".repeat(834).trim();
    const [statement] = build(`## Long\n\n${words}\n`);

    expect(textsOf(statement)).toEqual([`${words.slice(0, 4000)}…`]);
  });

  it("keeps the text on the first of four split parts and on none of .2, .3 and .4", () => {
    const links = Array.from(
      { length: 80 },
      (_, i) => `[validated by case ${i}](src/a.test.ts#L${i + 1})`,
    );
    const pushed = build(`## Many\n\n- FR1 — Linked. (${links.join(", ")})\n`);

    expect(pushed.map(textsOf)).toEqual([["FR1 — Linked."], [], [], []]);
  });
});

const FRESHNESS =
  "libs/shared/src/outbound/project/knowledge/context-freshness.test.ts";
const FRESHNESS_SOURCE = [
  'describe("embeddingWarning", () => {',
  '  it("names a 403 after 3 failures", () => {',
  "    expect(1).toBe(1);",
  "  });",
  "",
  '  it("adds nothing after 2 failures, below the degraded threshold", () => {',
  "    expect(2).toBe(2);",
  "  });",
  "});",
].join("\n");
const LEGACY_SPEC = [
  "## Freshness",
  "",
  `- FR1 — Warns. ([validated by \`context-freshness.test.ts:21\`](${FRESHNESS}#L6), [\`names a 403 after 3 failures\`](${FRESHNESS}#L2), [validated by](src/other.test.ts#L4), [\`gone.test.ts:9\`](src/gone.test.ts#L9))`,
  "",
].join("\n");
const buildLegacy = (testSources: ReadonlyMap<string, string>) =>
  statementItems({
    repo: "re-cinq/lore",
    path: "specs/mirror/spec.md",
    content: LEGACY_SPEC,
    commit: COMMIT,
    kind: "spec",
    testSources,
  });

describe("statementItems test titles", () => {
  it("names the test behind a context-freshness.test.ts:21 label by the title declared at its #L6 anchor, and a backticked title without its backticks", () => {
    const [fr1] = buildLegacy(new Map([[FRESHNESS, FRESHNESS_SOURCE]]));

    expect(fr1.e).toEqual([
      [`${DOC}#freshness`, "Section", true],
      [`${DOC}#s0000`, "Statement", true],
      [
        `re-cinq/lore:${FRESHNESS}::adds nothing after 2 failures, below the degraded threshold`,
        "Test",
        true,
      ],
      [`re-cinq/lore:${FRESHNESS}::names a 403 after 3 failures`, "Test", true],
    ]);
  });

  it("links no test for an empty label or a gone.test.ts:9 label whose source was not read", () => {
    const [fr1] = buildLegacy(new Map());

    expect(fr1.e).toEqual([
      [`${DOC}#freshness`, "Section", true],
      [`${DOC}#s0000`, "Statement", true],
      [`re-cinq/lore:${FRESHNESS}::names a 403 after 3 failures`, "Test", true],
    ]);
  });
});

describe("untitledTestPaths", () => {
  it("returns the context-freshness, other and gone test paths, whose labels name no title, once each", () => {
    expect(
      untitledTestPaths({ path: "specs/mirror/spec.md", content: LEGACY_SPEC }),
    ).toEqual([FRESHNESS, "src/other.test.ts", "src/gone.test.ts"]);
  });
});

function textsOf(pushed: StatementItem): Array<string | null> {
  return pushed.s
    .filter(
      ([, subject, phrase]) => subject.includes("#s") && phrase === "text",
    )
    .map(([, , , , value]) => value);
}
