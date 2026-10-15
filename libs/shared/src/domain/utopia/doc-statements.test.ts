import { describe, it, expect } from "vitest";
import { docStatementItems } from "./doc-statements.js";
import {
  attribute,
  fitsOneItem,
  relation,
  type StatementItem,
} from "./statements.js";

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
const BLOB = `https://github.com/re-cinq/lore/blob/${COMMIT}`;

const build = (content: string, commitTime?: string) =>
  docStatementItems({
    repo: "re-cinq/lore",
    path: "specs/mirror/spec.md",
    content,
    commit: COMMIT,
    commitTime,
    kind: "spec",
  });

describe("docStatementItems", () => {
  it("builds one doc item with the repository, the Spec document and its three sections, duplicate headings deduped as chain and chain-2", () => {
    const [doc] = build(SPEC, "2026-10-15T10:00:00Z");

    expect(doc).toEqual({
      externalId: "doc:specs/mirror/spec.md",
      doc_time: "2026-10-15T10:00:00Z",
      e: [
        ["re-cinq/lore", "Repository", true],
        [DOC, "Spec", true],
        [`${DOC}#feature-specification-mirror`, "Section", true],
        [`${DOC}#chain`, "Section", true],
        [`${DOC}#chain-2`, "Section", true],
      ],
      s: [
        relation("re-cinq/lore", "contains", DOC),
        attribute(DOC, "path", "specs/mirror/spec.md"),
        attribute(DOC, "commit", COMMIT),
        attribute(DOC, "permalink", `${BLOB}/specs/mirror/spec.md`),
        relation(DOC, "contains", `${DOC}#feature-specification-mirror`),
        attribute(
          `${DOC}#feature-specification-mirror`,
          "title",
          "Feature Specification: Mirror",
        ),
        attribute(`${DOC}#feature-specification-mirror`, "line_start", "1"),
        relation(DOC, "contains", `${DOC}#chain`),
        attribute(`${DOC}#chain`, "title", "Chain"),
        attribute(`${DOC}#chain`, "line_start", "7"),
        relation(DOC, "contains", `${DOC}#chain-2`),
        attribute(`${DOC}#chain-2`, "title", "Chain"),
        attribute(`${DOC}#chain-2`, "line_start", "12"),
      ],
    });
  });

  it("builds a statement item with two validated_by tests, titles taken after validated by, and one implemented_by source file", () => {
    const [, fr1] = build(SPEC, "2026-10-15T10:00:00Z");
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
    const [, , fr2] = build(SPEC);
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
        relation(stmt, "decided_by", adr),
      ],
    });
  });

  it("files the sentence under the second chain section as chain-2 and omits doc_time for an undated commit", () => {
    const pushed = build(SPEC);
    const sentence = pushed[3];

    expect({
      count: pushed.length,
      dated: pushed.filter((candidate) => "doc_time" in candidate).length,
      section: sentence.e[0],
      statement: sentence.s[0],
    }).toEqual({
      count: 4,
      dated: 0,
      section: [`${DOC}#chain-2`, "Section", true],
      statement: relation(`${DOC}#chain-2`, "contains", `${DOC}#s0002`),
    });
  });

  it("types an ADR's document as Adr", () => {
    const [doc] = docStatementItems({
      repo: "re-cinq/lore",
      path: "adrs/ADR-052.md",
      content: "# ADR-052\n\nDecided.\n",
      commit: COMMIT,
      kind: "adr",
    });

    expect(doc.e[1]).toEqual(["re-cinq/lore:adrs/ADR-052.md", "Adr", true]);
  });

  it("splits a statement with 80 test links into four items under 200 statements each that repeat the section and statement entities", () => {
    const links = Array.from(
      { length: 80 },
      (_, i) => `[validated by case ${i}](src/a.test.ts#L${i + 1})`,
    );
    const pushed = build(`## Many\n\n- FR1 — Linked. (${links.join(", ")})\n`);
    const parts = pushed.slice(1);
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
});
