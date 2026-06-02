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
  MAX_CANDIDATES_PER_SPEC,
  JUDGE_SCORE_THRESHOLD,
  type TestChunk,
  type Judgment,
  type MatchKind,
} from "./spec-test-linker.js";

const assertions = [
  { name: "claimNextTask", kind: "function" as const, description: "claims a task" },
  { name: "LeaseBackend", kind: "interface" as const, description: "lease interface" },
];

function chunk(overrides: Partial<TestChunk>): TestChunk {
  return {
    file_path: "src/x.test.ts",
    content: "",
    test_name: "x › y",
    test_line: 1,
    embedding: null,
    ...overrides,
  };
}

describe("specFeatureSlug", () => {
  it("returns the feature directory under specs/", () => {
    expect(specFeatureSlug("specs/local-task-runner/spec.md")).toBe("local-task-runner");
  });

  it("falls back to the parent directory when not under specs/", () => {
    expect(specFeatureSlug("docs/feature-x/design.md")).toBe("feature-x");
  });
});

describe("hasDirectoryAffinity", () => {
  it("matches local-task-runner spec to local-runner test on shared tokens", () => {
    expect(hasDirectoryAffinity("specs/local-task-runner/spec.md", "mcp-server/src/local-runner.test.ts")).toBe(true);
  });

  it("returns false when the test shares no significant tokens", () => {
    expect(hasDirectoryAffinity("specs/local-task-runner/spec.md", "web-ui/src/billing.test.ts")).toBe(false);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("matchedAssertion", () => {
  it("returns the assertion name the test references", () => {
    expect(matchedAssertion("it('claims', () => claimNextTask())", assertions)).toBe("claimNextTask");
  });

  it("returns null when no assertion is referenced", () => {
    expect(matchedAssertion("nothing relevant here", assertions)).toBeNull();
  });
});

describe("deriveTestName", () => {
  it("joins parent_symbol and symbol_name normalized", () => {
    expect(deriveTestName({ parent_symbol: "Local Runner", symbol_name: "claims task" })).toBe(
      "local runner › claims task",
    );
  });

  it("returns null when no symbol_name present", () => {
    expect(deriveTestName({ parent_symbol: "Local Runner" })).toBeNull();
  });
});

describe("parseEmbedding", () => {
  it("parses a pgvector string into numbers", () => {
    expect(parseEmbedding("[0.1,0.2,0.3]")).toEqual([0.1, 0.2, 0.3]);
  });

  it("passes through an existing array", () => {
    expect(parseEmbedding([1, 2])).toEqual([1, 2]);
  });

  it("returns null for empty or malformed input", () => {
    expect(parseEmbedding("")).toBeNull();
    expect(parseEmbedding("not json")).toBeNull();
    expect(parseEmbedding(null)).toBeNull();
  });
});

describe("selectCandidates", () => {
  const spec = { repo: "re-cinq/lore", file_path: "specs/local-task-runner/spec.md", content: "", embedding: null };

  it("flags an assertion-overlap candidate with its symbol", () => {
    const { candidates } = selectCandidates(spec, assertions, [
      chunk({ file_path: "src/runner.test.ts", content: "claimNextTask()", test_name: "runner › claims" }),
    ]);
    expect(candidates).toMatchObject([{ match_kind: "assertion", symbol: "claimNextTask" }]);
  });

  it("flags a directory-affinity candidate with null symbol", () => {
    const { candidates } = selectCandidates(spec, [], [
      chunk({ file_path: "src/local-runner.test.ts", content: "no symbols", test_name: "local runner › boots" }),
    ]);
    expect(candidates).toMatchObject([{ match_kind: "directory", symbol: null }]);
  });

  it("flags an embedding-proximity candidate above threshold", () => {
    const embeddingSpec = { ...spec, file_path: "specs/unrelated/spec.md", embedding: [1, 0, 0] };
    const { candidates } = selectCandidates(embeddingSpec, [], [
      chunk({ file_path: "src/other.test.ts", content: "x", test_name: "a › b", embedding: [1, 0, 0] }),
    ]);
    expect(candidates).toMatchObject([{ match_kind: "embedding" }]);
  });

  it("ignores non-test files", () => {
    const { candidates } = selectCandidates(spec, assertions, [
      chunk({ file_path: "src/local-runner.ts", content: "claimNextTask()", test_name: "x › y" }),
    ]);
    expect(candidates).toEqual([]);
  });

  it("keeps the strongest signal when a test matches multiple ways", () => {
    const { candidates } = selectCandidates(spec, assertions, [
      chunk({ file_path: "src/local-runner.test.ts", content: "claimNextTask()", test_name: "local runner › claims" }),
    ]);
    expect(candidates[0].match_kind).toBe("assertion");
  });

  it("caps at the candidate limit and reports truncation, keeping highest-ranked", () => {
    const dirChunks: TestChunk[] = Array.from({ length: MAX_CANDIDATES_PER_SPEC }, (_, i) =>
      chunk({ file_path: `src/local-runner-${i}.test.ts`, content: "none", test_name: `dir › ${i}` }),
    );
    const assertionChunk = chunk({
      file_path: "src/late.test.ts",
      content: "claimNextTask()",
      test_name: "assertion › late",
    });
    const result = selectCandidates(spec, assertions, [...dirChunks, assertionChunk]);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(MAX_CANDIDATES_PER_SPEC + 1);
    expect(result.candidates).toHaveLength(MAX_CANDIDATES_PER_SPEC);
    expect(result.candidates.some((c) => c.match_kind === "assertion")).toBe(true);
  });
});

describe("staleStatementOrdinals", () => {
  it("returns ordinals no longer present this run", () => {
    expect(staleStatementOrdinals([0, 1, 2, 3], [0, 2])).toEqual([1, 3]);
  });

  it("returns all existing ordinals when none are current", () => {
    expect(staleStatementOrdinals([0, 1], [])).toEqual([0, 1]);
  });

  it("returns nothing when current matches existing", () => {
    expect(staleStatementOrdinals([0, 1], [0, 1])).toEqual([]);
  });
});

describe("hashSpecContent", () => {
  it("returns identical hashes for identical input", () => {
    expect(hashSpecContent("# X\n\nbody")).toBe(hashSpecContent("# X\n\nbody"));
  });

  it("returns different hashes when content changes", () => {
    expect(hashSpecContent("# X")).not.toBe(hashSpecContent("# Y"));
  });

  it("returns a sha-256 hex digest", () => {
    expect(hashSpecContent("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("argmaxByTest", () => {
  const base = (overrides: Partial<Judgment> = {}): Judgment => ({
    test_file: "t.test.ts",
    test_name: "x › y",
    test_line: 1,
    symbol: null,
    match_kind: "directory" as MatchKind,
    matches: true,
    statement_ordinal: 0,
    statement_text: "stmt",
    match_score: 0.6,
    rationale: "r",
    ...overrides,
  });

  it("keeps only the highest-score row per (test_file, test_name)", () => {
    const out = argmaxByTest([
      base({ statement_ordinal: 0, match_score: 0.6 }),
      base({ statement_ordinal: 3, match_score: 0.9 }),
      base({ statement_ordinal: 5, match_score: 0.7, test_name: "other › z" }),
    ]);
    expect(out).toHaveLength(2);
    const dominant = out.find((j) => j.test_name === "x › y");
    expect(dominant?.statement_ordinal).toBe(3);
    expect(dominant?.match_score).toBe(0.9);
  });

  it("drops rows below the score threshold", () => {
    const out = argmaxByTest([
      base({ match_score: JUDGE_SCORE_THRESHOLD - 0.01 }),
    ]);
    expect(out).toEqual([]);
  });

  it("drops rows where matches=false", () => {
    const out = argmaxByTest([base({ matches: false, match_score: 0.95 })]);
    expect(out).toEqual([]);
  });

  it("permits a single statement to be the best match for multiple tests", () => {
    const out = argmaxByTest([
      base({ test_name: "a › 1", statement_ordinal: 7, match_score: 0.7 }),
      base({ test_name: "b › 2", statement_ordinal: 7, match_score: 0.8 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((j) => j.statement_ordinal === 7)).toBe(true);
  });
});

describe("staleLinkKeys", () => {
  const existing = [
    { test_file: "a.test.ts", test_name: "a › 1" },
    { test_file: "b.test.ts", test_name: "b › 1" },
  ];

  it("returns links not present in the confirmed set", () => {
    const stale = staleLinkKeys(existing, [{ test_file: "a.test.ts", test_name: "a › 1" }]);
    expect(stale).toEqual([{ test_file: "b.test.ts", test_name: "b › 1" }]);
  });

  it("returns all existing links when nothing is confirmed", () => {
    expect(staleLinkKeys(existing, [])).toEqual(existing);
  });
});
