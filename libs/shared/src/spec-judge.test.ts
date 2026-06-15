import { describe, it, expect } from "vitest";
import {
  specFeatureSlug,
  hasDirectoryAffinity,
  cosineSimilarity,
  matchedAssertion,
  deriveTestName,
  parseEmbedding,
  selectCandidates,
  staleLinkKeys,
  staleStatementOrdinals,
  argmaxByTest,
  hashSpecContent,
  type Assertion,
  type TestChunk,
  type SpecInput,
  type Judgment,
} from "./spec-judge.js";

describe("specFeatureSlug", () => {
  it("returns the feature directory under specs/", () => {
    expect(specFeatureSlug("specs/local-task-runner/spec.md")).toBe("local-task-runner");
  });

  it("falls back to the parent directory when there is no specs/ segment", () => {
    expect(specFeatureSlug("docs/feature/notes.md")).toBe("feature");
  });

  it("returns null for a bare filename", () => {
    expect(specFeatureSlug("spec.md")).toBeNull();
  });
});

describe("hasDirectoryAffinity", () => {
  it("returns true when the test path shares a majority of slug tokens", () => {
    expect(
      hasDirectoryAffinity("specs/local-task-runner/spec.md", "agent/src/local-task-runner.test.ts"),
    ).toBe(true);
  });

  it("returns false when the test path shares no slug tokens", () => {
    expect(
      hasDirectoryAffinity("specs/local-task-runner/spec.md", "web-ui/src/theme.test.ts"),
    ).toBe(false);
  });

  it("returns false when the slug has no significant tokens", () => {
    expect(hasDirectoryAffinity("specs/ab/spec.md", "agent/src/ab.test.ts")).toBe(false);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for empty or length-mismatched vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });

  it("returns 0 when either vector has zero magnitude", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("matchedAssertion", () => {
  const assertions: Assertion[] = [
    { name: "writeAuditLog", kind: "function", description: "" },
    { name: "Po", kind: "function", description: "" },
  ];

  it("returns the assertion name the content references, case-insensitively", () => {
    expect(matchedAssertion("calls WRITEAUDITLOG once", assertions)).toBe("writeAuditLog");
  });

  it("skips assertion names shorter than three characters", () => {
    expect(matchedAssertion("uses Po here", assertions)).toBeNull();
  });

  it("returns null when no assertion is referenced", () => {
    expect(matchedAssertion("unrelated content", assertions)).toBeNull();
  });
});

describe("deriveTestName", () => {
  it("joins parent_symbol and symbol_name into a normalized name", () => {
    expect(deriveTestName({ symbol_name: "returns true", parent_symbol: "isBusinessHours" })).toBe(
      "isbusinesshours › returns true",
    );
  });

  it("falls back to the describe key when parent_symbol is absent", () => {
    expect(deriveTestName({ symbol_name: "x", describe: "Group" })).toBe("group › x");
  });

  it("returns null for null metadata or a missing symbol name", () => {
    expect(deriveTestName(null)).toBeNull();
    expect(deriveTestName({ parent_symbol: "X" })).toBeNull();
  });
});

describe("parseEmbedding", () => {
  it("returns the array unchanged when already an array", () => {
    expect(parseEmbedding([0.1, 0.2])).toEqual([0.1, 0.2]);
  });

  it("parses a pgvector string representation", () => {
    expect(parseEmbedding("[0.1,0.2,0.3]")).toEqual([0.1, 0.2, 0.3]);
  });

  it("returns null for malformed, empty, or non-string input", () => {
    expect(parseEmbedding("not json")).toBeNull();
    expect(parseEmbedding("")).toBeNull();
    expect(parseEmbedding(123)).toBeNull();
  });
});

describe("selectCandidates", () => {
  const spec: SpecInput = {
    repo: "re-cinq/lore",
    file_path: "specs/local-task-runner/spec.md",
    content: "spec body",
    embedding: [1, 0],
  };
  const assertions: Assertion[] = [{ name: "runTaskLocally", kind: "function", description: "" }];

  const chunk = (over: Partial<TestChunk>): TestChunk => ({
    file_path: "agent/src/other.test.ts",
    content: "body",
    test_name: "case",
    test_line: 1,
    embedding: null,
    ...over,
  });

  it("classifies an assertion-overlap candidate as kind 'assertion'", () => {
    const out = selectCandidates(spec, assertions, [
      chunk({ content: "expect(runTaskLocally()).toBe(1)" }),
    ]);
    expect(out.candidates).toMatchObject([{ match_kind: "assertion", symbol: "runTaskLocally" }]);
    expect(out).toMatchObject({ truncated: false, total: 1 });
  });

  it("falls back to directory affinity then embedding proximity", () => {
    const out = selectCandidates(spec, [], [
      chunk({ file_path: "agent/src/local-task-runner.test.ts" }),
      chunk({ file_path: "agent/src/unrelated.test.ts", embedding: [1, 0] }),
    ]);
    expect(out.candidates.map((c) => c.match_kind).sort()).toEqual(["directory", "embedding"]);
  });

  it("skips non-test files and chunks with no test name", () => {
    const out = selectCandidates(spec, assertions, [
      chunk({ file_path: "agent/src/runner.ts", content: "runTaskLocally" }),
      chunk({ content: "runTaskLocally", test_name: "" }),
    ]);
    expect(out.candidates).toEqual([]);
  });

  it("dedups by test, keeping the strongest signal", () => {
    const out = selectCandidates(spec, assertions, [
      chunk({ file_path: "agent/src/local-task-runner.test.ts", content: "runTaskLocally here" }),
    ]);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].match_kind).toBe("assertion");
  });

  it("caps at maxCandidates and flags truncation", () => {
    const chunks = Array.from({ length: 3 }, (_, i) =>
      chunk({ file_path: `agent/src/local-task-runner-${i}.test.ts`, test_name: `case ${i}` }),
    );
    const out = selectCandidates(spec, [], chunks, { maxCandidates: 2 });
    expect(out).toMatchObject({ truncated: true, total: 3 });
    expect(out.candidates).toHaveLength(2);
  });
});

describe("argmaxByTest", () => {
  const judgment = (over: Partial<Judgment>): Judgment => ({
    test_file: "a.test.ts",
    test_name: "case",
    test_line: 1,
    symbol: null,
    match_kind: "assertion",
    matches: true,
    statement_ordinal: 0,
    statement_text: "s",
    match_score: 0.9,
    rationale: "r",
    ...over,
  });

  it("keeps the highest-scoring judgment per test", () => {
    const out = argmaxByTest([
      judgment({ match_score: 0.6 }),
      judgment({ match_score: 0.95, statement_ordinal: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ match_score: 0.95, statement_ordinal: 1 });
  });

  it("drops non-matches and sub-threshold scores", () => {
    expect(argmaxByTest([judgment({ matches: false })])).toEqual([]);
    expect(argmaxByTest([judgment({ match_score: 0.3 })])).toEqual([]);
  });
});

describe("staleLinkKeys", () => {
  it("returns existing links no longer confirmed this run", () => {
    const existing = [
      { test_file: "a.test.ts", test_name: "one" },
      { test_file: "b.test.ts", test_name: "two" },
    ];
    expect(staleLinkKeys(existing, [{ test_file: "a.test.ts", test_name: "one" }])).toEqual([
      { test_file: "b.test.ts", test_name: "two" },
    ]);
  });
});

describe("staleStatementOrdinals", () => {
  it("returns ordinals no longer present in the current run", () => {
    expect(staleStatementOrdinals([0, 1, 2], [0, 2])).toEqual([1]);
  });
});

describe("hashSpecContent", () => {
  it("returns a stable 64-char sha-256 hex digest", () => {
    const hash = hashSpecContent("spec body");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSpecContent("spec body")).toBe(hash);
  });

  it("returns a different digest for different content", () => {
    expect(hashSpecContent("a")).not.toBe(hashSpecContent("b"));
  });
});
