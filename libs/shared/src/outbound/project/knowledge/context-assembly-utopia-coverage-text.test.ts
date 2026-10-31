import { describe, it, expect } from "vitest";
import { coverageText } from "./context-assembly-utopia-coverage-text.js";

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
        "  defines prFooter (L20-L31)",
      ].join("\n"),
    );
  });

  it("keeps the id and the raw text of a chunk that is no tuple", () => {
    expect(coverageText("code:a.ts", " tail of a split item ")).toEqual(
      "code:a.ts\ntail of a split item",
    );
  });
});
