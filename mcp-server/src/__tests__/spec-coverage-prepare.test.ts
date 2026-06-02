import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { prepareSpecCoverage } from "../spec-coverage-prepare.js";

interface Query {
  text: string;
  params?: unknown[];
}

function mockPool(rowsByMatcher: { match: (q: Query) => boolean; rows: unknown[] }[]): Pool {
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      const q = { text, params };
      for (const entry of rowsByMatcher) {
        if (entry.match(q)) return { rows: entry.rows, rowCount: entry.rows.length };
      }
      throw new Error(`unmocked query: ${text.slice(0, 80)}`);
    }),
  } as unknown as Pool;
}

const repo = "test-org/cov-demo";
const specPath = "specs/cov-demo/spec.md";

const specContent = `# Feature Specification: Cov Demo

A short intro paragraph.

## Acceptance Criteria

1. Returns the expected value.
2. Throws a ValidationError when called with null.

## Limitations

- A v1 limitation that cannot be enforced.
`;

const baseMocks = (extra: { match: (q: Query) => boolean; rows: unknown[] }[] = []) => [
  // resolvePrepareSchema: lore.repos team lookup
  {
    match: (q: Query) => q.text.includes("SELECT team FROM lore.repos"),
    rows: [{ team: "platform" }],
  },
  // resolvePrepareSchema: schema existence check
  {
    match: (q: Query) => q.text.includes("information_schema.schemata"),
    rows: [{ "?column?": 1 }],
  },
  // spec chunks
  {
    match: (q: Query) => q.text.includes("WHERE content_type = 'spec'"),
    rows: [{ content: specContent, ingested_at: "2026-01-01T00:00:00Z", embedding: null }],
  },
  // code chunks
  {
    match: (q: Query) => q.text.includes("content_type = 'code'"),
    rows: [
      {
        file_path: "src/demo.test.ts",
        content: "describe('cov-demo', () => { it('returns', () => {}) })",
        metadata: { parent_symbol: "cov-demo", symbol_name: "returns", start_line: 8 },
        embedding: null,
      },
    ],
  },
  ...extra,
];

describe("prepareSpecCoverage", () => {
  it("returns null when no spec chunks exist for the path", async () => {
    const pool = mockPool([
      { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
      { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
      { match: (q) => q.text.includes("WHERE content_type = 'spec'"), rows: [] },
    ]);
    expect(await prepareSpecCoverage(pool, repo, specPath)).toBeNull();
  });

  it("returns deterministic statements with heuristic classifications", async () => {
    const pool = mockPool(baseMocks([
      { match: (q) => q.text.includes("coverage_lines"), rows: [] },
    ]));
    const out = await prepareSpecCoverage(pool, repo, specPath);
    expect(out).not.toBeNull();
    expect(out!.statements.length).toBeGreaterThan(0);
    // intro paragraph should be marked untestable/intro by heuristic
    const intro = out!.statements.find((s) => s.text.startsWith("A short intro"));
    expect(intro?.heuristic).toMatchObject({
      testability: "untestable",
      category: "intro",
      matched_by_section: true,
    });
    // limitation list item should be untestable/limitation
    const lim = out!.statements.find((s) => s.text.startsWith("A v1 limitation"));
    expect(lim?.heuristic).toMatchObject({ testability: "untestable", category: "limitation" });
    // acceptance criteria items default testable
    const ac = out!.statements.find((s) => s.text.startsWith("Returns the expected"));
    expect(ac?.heuristic).toMatchObject({ testability: "testable", category: null });
  });

  it("returns a stable content_hash matching the reassembled hash", async () => {
    const pool = mockPool(baseMocks([
      { match: (q) => q.text.includes("coverage_lines"), rows: [] },
    ]));
    const first = await prepareSpecCoverage(pool, repo, specPath);
    const second = await prepareSpecCoverage(pool, repo, specPath);
    expect(first!.content_hash).toBe(second!.content_hash);
    expect(first!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("populates candidate_tests via the directory-affinity pre-filter", async () => {
    const pool = mockPool(baseMocks([
      { match: (q) => q.text.includes("coverage_lines"), rows: [] },
    ]));
    const out = await prepareSpecCoverage(pool, repo, specPath);
    expect(out!.candidate_tests).toHaveLength(1);
    expect(out!.candidate_tests[0]).toMatchObject({
      test_file: "src/demo.test.ts",
      test_name: "cov-demo › returns",
      test_line: 8,
      match_kind: "directory",
      coverage_hits: [],
    });
  });

  it("degrades gracefully when the coverage_lines table doesn't exist (42P01)", async () => {
    const pool = mockPool([
      ...baseMocks(),
      {
        match: (q) => q.text.includes("coverage_lines"),
        rows: [],
      },
    ]);
    // override the coverage_lines mock to throw 42P01
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (text: string, params?: unknown[]) => {
      if (text.includes("coverage_lines")) {
        const err = new Error('relation "platform.coverage_lines" does not exist') as Error & { code: string };
        err.code = "42P01";
        throw err;
      }
      if (text.includes("SELECT team FROM lore.repos")) return { rows: [{ team: "platform" }] };
      if (text.includes("information_schema.schemata")) return { rows: [{}] };
      if (text.includes("content_type = 'spec'")) return {
        rows: [{ content: specContent, ingested_at: "2026-01-01T00:00:00Z", embedding: null }],
      };
      if (text.includes("content_type = 'code'")) return {
        rows: [{
          file_path: "src/demo.test.ts",
          content: "x",
          metadata: { parent_symbol: "cov-demo", symbol_name: "returns" },
          embedding: null,
        }],
      };
      throw new Error(`unmocked: ${text.slice(0, 80)}`);
    });
    const out = await prepareSpecCoverage(pool, repo, specPath);
    expect(out).not.toBeNull();
    expect(out!.candidate_tests[0].coverage_hits).toEqual([]);
  });

  it("returns null assertion_hints when none provided", async () => {
    const pool = mockPool(baseMocks([
      { match: (q) => q.text.includes("coverage_lines"), rows: [] },
    ]));
    const out = await prepareSpecCoverage(pool, repo, specPath);
    expect(out!.assertion_hints).toBeNull();
  });

  it("echoes assertion names back as hints when provided", async () => {
    const pool = mockPool(baseMocks([
      { match: (q) => q.text.includes("coverage_lines"), rows: [] },
    ]));
    const out = await prepareSpecCoverage(pool, repo, specPath, [
      { name: "claimNextTask", kind: "function", description: "x" },
    ]);
    expect(out!.assertion_hints).toEqual(["claimNextTask"]);
  });

  it("orders statement ordinals deterministically (0, 1, 2, ...)", async () => {
    const pool = mockPool(baseMocks([
      { match: (q) => q.text.includes("coverage_lines"), rows: [] },
    ]));
    const out = await prepareSpecCoverage(pool, repo, specPath);
    expect(out!.statements.map((s) => s.ordinal)).toEqual(
      out!.statements.map((_, i) => i),
    );
  });
});
