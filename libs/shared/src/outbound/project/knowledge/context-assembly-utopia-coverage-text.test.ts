import { describe, it, expect } from "vitest";
import {
  citedSpans,
  coverageText,
} from "./context-assembly-utopia-coverage-text.js";

const SPEC = "specs/6-dark-factory/spec.md";
const TEST_FILE = "libs/shared/src/domain/pr-body.test.ts";

interface RowParts {
  object?: string;
  value?: string;
  qualifiers?: Record<string, string | number>;
}
const row = (subject: string, phrase: string, parts: RowParts = {}) => [
  null,
  subject,
  phrase,
  parts.object ?? null,
  parts.value ?? null,
  parts.qualifiers ?? {},
  null,
  null,
];

const statementTuple = JSON.stringify({
  e: [
    ["re-cinq/lore", "Repository", true],
    [`${SPEC}#0146`, "Statement", true],
    ["re-cinq/lore:t1", "Test", true],
    ["re-cinq/lore:libs/shared/src/domain/pr-body.ts", "SourceFile", true],
  ],
  s: [
    row(`${SPEC}#0146`, "text", { value: "A PR footer names its task." }),
    row(`${SPEC}#0146`, "validated_by", { object: "re-cinq/lore:t1" }),
    row("re-cinq/lore:t1", "title", { value: "prints Lore-Task" }),
    row("re-cinq/lore:t1", "path", { value: TEST_FILE }),
    row("re-cinq/lore:t1", "line_start", { value: "12" }),
    row(`${SPEC}#0146`, "implemented_by", {
      object: "re-cinq/lore:libs/shared/src/domain/pr-body.ts",
    }),
    row("re-cinq/lore:libs/shared/src/domain/pr-body.ts", "path", {
      value: "libs/shared/src/domain/pr-body.ts",
    }),
  ],
  external_id: `stmt:${SPEC}#0146`,
});

const testTuple = JSON.stringify({
  e: [
    ["re-cinq/lore:t1", "Test", true],
    ["re-cinq/lore:f1", "SourceFile", true],
  ],
  s: [
    row("re-cinq/lore:t1", "title", { value: "prints Lore-Task" }),
    row("re-cinq/lore:t1", "path", { value: TEST_FILE }),
    row("re-cinq/lore:t1", "line_start", { value: "12" }),
    row("re-cinq/lore:t1", "outcome", { value: "passed" }),
    row("re-cinq/lore:f1", "path", {
      value: "libs/shared/src/domain/pr-body.ts",
    }),
    row("re-cinq/lore:t1", "covers", {
      object: "re-cinq/lore:f1",
      qualifiers: { lines: "7-7,9-14" },
    }),
    row(`${SPEC}#0146`, "validated_by", { object: "re-cinq/lore:t1" }),
  ],
  external_id: `test:${TEST_FILE}`,
});

const codeTuple = JSON.stringify({
  e: [
    ["re-cinq/lore:f1", "SourceFile", true],
    ["re-cinq/lore:f1#prFooter", "CodeDefinition", true],
  ],
  s: [
    row("re-cinq/lore:f1", "path", {
      value: "libs/shared/src/domain/pr-body.ts",
    }),
    row("re-cinq/lore:f1", "defines", { object: "re-cinq/lore:f1#prFooter" }),
    row("re-cinq/lore:f1#prFooter", "symbol", { value: "prFooter" }),
    row("re-cinq/lore:f1#prFooter", "kind", { value: "function" }),
    row("re-cinq/lore:f1#prFooter", "exported", { value: "false" }),
    row("re-cinq/lore:f1#prFooter", "line_start", { value: "20" }),
    row("re-cinq/lore:f1#prFooter", "line_end", { value: "31" }),
  ],
  external_id: "code:libs/shared/src/domain/pr-body.ts",
});

describe("coverageText", () => {
  it("renders stmt:specs/6-dark-factory/spec.md#0146 as its text with the test prints Lore-Task at pr-body.test.ts:12 and the file pr-body.ts", () => {
    expect(coverageText(`stmt:${SPEC}#0146`, statementTuple)).toEqual(
      [
        `${SPEC}#0146: A PR footer names its task.`,
        `  validated by prints Lore-Task (${TEST_FILE}:12)`,
        "  implemented by libs/shared/src/domain/pr-body.ts",
      ].join("\n"),
    );
  });

  it("renders a test: item with outcome=passed, the covered lines 7-7,9-14 and the statement it validates", () => {
    expect(coverageText(`test:${TEST_FILE}`, testTuple)).toEqual(
      [
        `prints Lore-Task (${TEST_FILE}:12) outcome=passed`,
        "  covers libs/shared/src/domain/pr-body.ts lines 7-7,9-14",
        `  validates ${SPEC}#0146`,
      ].join("\n"),
    );
  });

  it("renders a code: item as its file with prFooter defined at L20-L31", () => {
    expect(
      coverageText("code:libs/shared/src/domain/pr-body.ts", codeTuple),
    ).toEqual(
      [
        "libs/shared/src/domain/pr-body.ts",
        "  function prFooter (L20-L31)",
      ].join("\n"),
    );
  });

  it("keeps the id and the raw text of a chunk that is no tuple", () => {
    expect(coverageText("code:a.ts", " tail of a split item ")).toEqual(
      "code:a.ts\ntail of a split item",
    );
  });
});

const RUNNER = "re-cinq/lore:src/runner.ts";
const hashedTestTuple = JSON.stringify({
  e: [
    ["re-cinq/lore", "Repository", true],
    ["re-cinq/lore:t1", "Test", true],
    [RUNNER, "SourceFile", true],
  ],
  s: [
    row("re-cinq/lore:t1", "title", { value: "prints Lore-Task" }),
    row("re-cinq/lore:t1", "path", { value: TEST_FILE }),
    row("re-cinq/lore:t1", "line_start", { value: "12" }),
    row("re-cinq/lore:t1", "anchor_hash", { value: "1e7912b3" }),
    row("re-cinq/lore:t1", "outcome", { value: "passed" }),
    row("re-cinq/lore:t1", "covers", {
      object: RUNNER,
      qualifiers: { lines: "7-7,9-14" },
    }),
  ],
});

const classTuple = JSON.stringify({
  e: [
    [RUNNER, "SourceFile", true],
    [`${RUNNER}#Runner`, "CodeDefinition", true],
    [`${RUNNER}#Runner.step`, "CodeDefinition", true],
    ["re-cinq/lore:src/base.ts#Base", "CodeDefinition", true],
    [`${RUNNER}#advance`, "CodeDefinition", true],
  ],
  s: [
    row(RUNNER, "path", { value: "src/runner.ts" }),
    row(RUNNER, "defines", { object: `${RUNNER}#Runner` }),
    row(`${RUNNER}#Runner`, "symbol", { value: "Runner" }),
    row(`${RUNNER}#Runner`, "kind", { value: "class" }),
    row(`${RUNNER}#Runner`, "exported", { value: "true" }),
    row(`${RUNNER}#Runner`, "line_start", { value: "1" }),
    row(`${RUNNER}#Runner`, "line_end", { value: "7" }),
    row(`${RUNNER}#Runner`, "extends", {
      object: "re-cinq/lore:src/base.ts#Base",
    }),
    row(RUNNER, "defines", { object: `${RUNNER}#Runner.step` }),
    row(`${RUNNER}#Runner.step`, "symbol", { value: "Runner.step" }),
    row(`${RUNNER}#Runner.step`, "kind", { value: "method" }),
    row(`${RUNNER}#Runner.step`, "exported", { value: "true" }),
    row(`${RUNNER}#Runner.step`, "line_start", { value: "3" }),
    row(`${RUNNER}#Runner.step`, "line_end", { value: "3" }),
    row(`${RUNNER}#Runner`, "contains", { object: `${RUNNER}#Runner.step` }),
    row(`${RUNNER}#Runner.step`, "references", {
      object: `${RUNNER}#advance`,
    }),
    row(RUNNER, "defines", { object: `${RUNNER}#advance` }),
    row(`${RUNNER}#advance`, "symbol", { value: "advance" }),
    row(`${RUNNER}#advance`, "kind", { value: "function" }),
    row(`${RUNNER}#advance`, "exported", { value: "false" }),
    row(`${RUNNER}#advance`, "line_start", { value: "9" }),
    row(`${RUNNER}#advance`, "line_end", { value: "11" }),
  ],
});

const definitionStatementTuple = JSON.stringify({
  e: [
    [`${SPEC}#0146`, "Statement", true],
    [RUNNER, "SourceFile", true],
    [`${RUNNER}#advance`, "CodeDefinition", true],
  ],
  s: [
    row(`${SPEC}#0146`, "text", { value: "A runner advances." }),
    row(`${SPEC}#0146`, "implemented_by", { object: `${RUNNER}#advance` }),
    row(RUNNER, "defines", { object: `${RUNNER}#advance` }),
    row(`${RUNNER}#advance`, "symbol", { value: "advance" }),
    row(RUNNER, "path", { value: "src/runner.ts" }),
  ],
});

describe("coverageText in the one-item-per-test shape", () => {
  it("renders covers lines from the entity name when the covered file has no path row", () => {
    expect(coverageText(`test:${TEST_FILE}#1e7912b3`, hashedTestTuple)).toEqual(
      [
        `prints Lore-Task (${TEST_FILE}:12) @1e7912b3 outcome=passed`,
        "  covers src/runner.ts lines 7-7,9-14",
      ].join("\n"),
    );
  });

  it("nests Runner.step under class Runner with kind and exported", () => {
    expect(coverageText("code:src/runner.ts", classTuple)).toEqual(
      [
        "src/runner.ts",
        "  class Runner (L1-L7, exported) extends Base",
        "    method Runner.step (L3-L3, exported) references advance",
        "  function advance (L9-L11)",
      ].join("\n"),
    );
  });

  it("prints implemented by advance for a definition object", () => {
    expect(coverageText(`stmt:${SPEC}#0146`, definitionStatementTuple)).toEqual(
      [`${SPEC}#0146: A runner advances.`, "  implemented by advance"].join(
        "\n",
      ),
    );
  });

  it("cites the covered range of src/runner.ts by the entity name when the file has no path row", () => {
    expect(citedSpans(`test:${TEST_FILE}#1e7912b3`, hashedTestTuple)).toEqual([
      { path: TEST_FILE, start: 12, end: null },
      { path: "src/runner.ts", start: 7, end: 7 },
      { path: "src/runner.ts", start: 9, end: 14 },
    ]);
  });
});

describe("citedSpans", () => {
  it("cites the test prints Lore-Task from line 12 with no end for stmt:specs/6-dark-factory/spec.md#0146, and nothing for its implemented-by file", () => {
    expect(citedSpans(`stmt:${SPEC}#0146`, statementTuple)).toEqual([
      { path: TEST_FILE, start: 12, end: null },
    ]);
  });

  it("cites the test itself from line 12 then the covered ranges 7-7 and 9-14 of pr-body.ts for a test: item", () => {
    expect(citedSpans(`test:${TEST_FILE}`, testTuple)).toEqual([
      { path: TEST_FILE, start: 12, end: null },
      { path: "libs/shared/src/domain/pr-body.ts", start: 7, end: 7 },
      { path: "libs/shared/src/domain/pr-body.ts", start: 9, end: 14 },
    ]);
  });

  it("cites nothing for a code: item or a chunk that is no tuple", () => {
    expect(
      citedSpans("code:libs/shared/src/domain/pr-body.ts", codeTuple),
    ).toEqual([]);
    expect(citedSpans("test:a.test.ts", "tail of a split item")).toEqual([]);
  });
});
