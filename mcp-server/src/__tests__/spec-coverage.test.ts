import { describe, it, expect } from "vitest";
import { composeSpecCoverage } from "../routes.js";

const chunks = [
  {
    file_path: "specs/x/spec.md",
    content: "# Feature Specification: X\n\nIntro line.\n\n## Acceptance Criteria\n\n1. Returns true.\n2. Throws on null.\n",
    ingested_at: "2026-01-01T00:00:00Z",
  },
];

const statements = [
  { spec_path: "specs/x/spec.md", ordinal: 0, text: "Intro line.", kind: "sentence", testability: "untestable", category: "intro" },
  { spec_path: "specs/x/spec.md", ordinal: 1, text: "Returns true.", kind: "list-item", testability: "testable", category: null },
  { spec_path: "specs/x/spec.md", ordinal: 2, text: "Throws on null.", kind: "list-item", testability: "testable", category: null },
];

describe("composeSpecCoverage", () => {
  it("computes coverage from statements + links", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, statements, [
      {
        spec_path: "specs/x/spec.md",
        test_file: "src/x.test.ts",
        test_name: "x › returns true",
        test_line: 10,
        symbol: null,
        match_kind: "directory",
        rationale: "exercises the true path",
        statement_ordinal: 1,
        statement_text: "Returns true.",
        match_score: 0.82,
      },
    ]);
    expect(out.coverage).toEqual({ testable: 2, covered: 1, untestable: 1 });
    expect(out.test_count).toBe(1);
  });

  it("emits every statement in the payload so the renderer can paint untestables grey", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, statements, []);
    expect(out.statements).toHaveLength(3);
    expect(out.statements[0]).toMatchObject({ ordinal: 0, testability: "untestable", category: "intro" });
  });

  it("attaches statement_ordinal + match_score per test row", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, statements, [
      {
        spec_path: "specs/x/spec.md",
        test_file: "src/x.test.ts",
        test_name: "x › throws on null",
        test_line: null,
        symbol: "throwOnNull",
        match_kind: "assertion",
        rationale: "exercises null-path",
        statement_ordinal: 2,
        statement_text: "Throws on null.",
        match_score: 0.91,
      },
    ]);
    expect(out.tests[0]).toMatchObject({
      statement_ordinal: 2,
      match_score: 0.91,
      url: "https://github.com/re-cinq/lore/blob/HEAD/src/x.test.ts",
    });
  });

  it("returns covered=0 when no test links a testable statement", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, statements, []);
    expect(out.coverage).toEqual({ testable: 2, covered: 0, untestable: 1 });
  });

  it("ignores links whose statement_ordinal is null toward 'covered'", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, statements, [
      {
        spec_path: "specs/x/spec.md",
        test_file: "src/legacy.test.ts",
        test_name: "legacy whole-spec",
        test_line: null,
        symbol: null,
        match_kind: "directory",
        rationale: "legacy row, no ordinal",
        statement_ordinal: null,
        statement_text: null,
        match_score: null,
      },
    ]);
    expect(out.coverage.covered).toBe(0);
    expect(out.test_count).toBe(1);
  });

  it("returns zero coverage with empty statements (legacy / no spec_statements row)", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, [], []);
    expect(out.coverage).toEqual({ testable: 0, covered: 0, untestable: 0 });
    expect(out.statements).toEqual([]);
  });

  it("surfaces last_linked_at + last_linked_by when a coverage_runs row is passed", () => {
    const out = composeSpecCoverage(
      "re-cinq/lore",
      "specs/x/spec.md",
      chunks,
      statements,
      [],
      { run_at: "2026-06-02T13:00:00Z", linked_by: "local:abc" },
    );
    expect(out.last_linked_at).toBe("2026-06-02T13:00:00Z");
    expect(out.last_linked_by).toBe("local:abc");
  });

  it("returns last_linked_* as null when no coverage_runs row is supplied", () => {
    const out = composeSpecCoverage("re-cinq/lore", "specs/x/spec.md", chunks, statements, []);
    expect(out.last_linked_at).toBeNull();
    expect(out.last_linked_by).toBeNull();
  });
});
