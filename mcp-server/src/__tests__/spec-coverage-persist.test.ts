import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { persistSpecCoverage } from "../spec-coverage-persist.js";

interface Query {
  text: string;
  params?: unknown[];
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

interface MockState {
  /** Calls made to pool.query, in order. */
  calls: Query[];
  /** Override result for a query matcher. */
  overrides: Array<{ match: (q: Query) => boolean; rows: unknown[] }>;
}

function makePool(state: MockState): Pool {
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      const q = { text, params };
      state.calls.push(q);
      for (const o of state.overrides) {
        if (o.match(q)) return { rows: o.rows, rowCount: o.rows.length };
      }
      // Defaults: empty rows for SELECTs, no-op for writes
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
}

function withSpec(state: MockState): MockState {
  state.overrides.push(
    { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
    { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
    {
      match: (q) => q.text.includes("WHERE content_type = 'spec'"),
      rows: [{ content: specContent, ingested_at: "2026-01-01T00:00:00Z", embedding: null }],
    },
  );
  return state;
}

describe("persistSpecCoverage", () => {
  it("returns 409 when the supplied content_hash no longer matches the current hash", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: "stale-hash",
      classifications: [],
      judgments: [],
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: "content_hash_stale",
      current_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("returns 404 when no spec chunks exist at the path", async () => {
    const state: MockState = { calls: [], overrides: [] };
    state.overrides.push(
      { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
      { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
      { match: (q) => q.text.includes("WHERE content_type = 'spec'"), rows: [] },
    );
    const pool = makePool(state);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: "x",
      classifications: [],
      judgments: [],
    });
    expect(result.status).toBe(404);
  });

  it("returns 400 invalid_ordinal when classifications references an ordinal not in the segmented set", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    // Build the current hash first via a real prepare round-trip
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [{ ordinal: 999, testability: "testable" }],
      judgments: [],
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_ordinal", ordinal: 999 });
  });

  it("returns 400 invalid_ordinal when a judgment references an ordinal not in the testable set", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [{
        test_file: "src/x.test.ts",
        test_name: "x › y",
        statement_ordinal: 999,
        score: 0.8,
        rationale: "x",
      }],
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_ordinal", ordinal: 999 });
  });

  it("returns 400 invalid_score when a judgment score is below the tau threshold", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    // pick a testable ordinal from the prep payload
    const ord = prep!.statements.find((s) => s.heuristic.testability === "testable")!.ordinal;
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [{
        test_file: "src/x.test.ts",
        test_name: "x › y",
        statement_ordinal: ord,
        score: 0.3,
        rationale: "low",
      }],
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_score", score: 0.3 });
  });

  it("returns 400 invalid_score when a judgment score exceeds 1", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const ord = prep!.statements.find((s) => s.heuristic.testability === "testable")!.ordinal;
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [{
        test_file: "src/x.test.ts",
        test_name: "x › y",
        statement_ordinal: ord,
        score: 1.4,
        rationale: "x",
      }],
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_score", score: 1.4 });
  });

  it("dedups two judgments for the same (test_file, test_name) via server-side argmax", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const testable = prep!.statements.filter((s) => s.heuristic.testability === "testable");
    expect(testable.length).toBeGreaterThanOrEqual(2);
    const [a, b] = testable;
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [
        { test_file: "src/x.test.ts", test_name: "x › y", statement_ordinal: a.ordinal, score: 0.6, rationale: "low" },
        { test_file: "src/x.test.ts", test_name: "x › y", statement_ordinal: b.ordinal, score: 0.9, rationale: "high" },
      ],
      agent_id: "test-agent",
    });
    expect(result.status).toBe(200);
    // exactly one link row written for this test (the higher-score one)
    const linkWrites = state.calls.filter(
      (q) => q.text.includes("INSERT INTO") && q.text.includes("spec_test_links"),
    );
    expect(linkWrites).toHaveLength(1);
    const params = linkWrites[0].params as unknown[];
    expect(params).toContain(b.ordinal); // the higher-score statement_ordinal
    expect(params).toContain(0.9);       // the higher score
  });

  it("writes spec_coverage_runs.linked_by = 'local:{agent_id}' on success", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [],
      agent_id: "abc123",
    });
    expect(result.status).toBe(200);
    const runWrites = state.calls.filter(
      (q) => q.text.includes("INSERT INTO") && q.text.includes("spec_coverage_runs"),
    );
    expect(runWrites.length).toBeGreaterThan(0);
    expect(runWrites[runWrites.length - 1].params).toContain("local:abc123");
  });

  it("defaults linked_by to 'local:unknown' when agent_id is absent", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [],
    });
    expect(result.status).toBe(200);
    const runWrites = state.calls.filter(
      (q) => q.text.includes("INSERT INTO") && q.text.includes("spec_coverage_runs"),
    );
    expect(runWrites.length).toBeGreaterThan(0);
    expect(runWrites[runWrites.length - 1].params).toContain("local:unknown");
  });

  it("writes spec_statements rows for each statement and prunes stale ordinals", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    // Existing ordinals: 99 (no longer present this run) should get pruned
    state.overrides.push({
      match: (q) => q.text.includes("SELECT ordinal FROM") && q.text.includes("spec_statements"),
      rows: [{ ordinal: 99 }],
    });
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [],
    });
    expect(result.status).toBe(200);
    const stmtInserts = state.calls.filter(
      (q) => q.text.includes("INSERT INTO") && q.text.includes("spec_statements"),
    );
    expect(stmtInserts.length).toBe(prep!.statements.length);
    const stmtDeletes = state.calls.filter(
      (q) => q.text.includes("DELETE FROM") && q.text.includes("spec_statements"),
    );
    expect(stmtDeletes.length).toBe(1); // ordinal 99
    expect(stmtDeletes[0].params).toContain(99);
  });

  it("returns the same SpecCoverageEntry shape the GET /spec-coverage handler returns", async () => {
    const state: MockState = { calls: [], overrides: [] };
    withSpec(state);
    const pool = makePool(state);
    const { prepareSpecCoverage } = await import("../spec-coverage-prepare.js");
    const prep = await prepareSpecCoverage(pool, repo, specPath);
    const result = await persistSpecCoverage(pool, repo, specPath, {
      spec_path: specPath,
      content_hash: prep!.content_hash,
      classifications: [],
      judgments: [],
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      spec_path: specPath,
      title: expect.any(String),
      summary: expect.any(String),
      coverage: { testable: expect.any(Number), covered: expect.any(Number), untestable: expect.any(Number) },
      statements: expect.any(Array),
      tests: expect.any(Array),
    });
  });
});
