import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { listStaleSpecCoverage } from "../spec-coverage-stale.js";

interface Query {
  text: string;
  params?: unknown[];
}

const repo = "test-org/cov-demo";

const specA = "specs/spec-a/spec.md";
const specB = "specs/spec-b/spec.md";
const specC = "specs/spec-c/spec.md";

const contentFor = (name: string) => `# Feature Specification: ${name}\n\nBody for ${name}.\n`;

function makePool(overrides: Array<{ match: (q: Query) => boolean; rows: unknown[] }>): Pool {
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      const q = { text, params };
      for (const o of overrides) {
        if (o.match(q)) return { rows: o.rows, rowCount: o.rows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
}

describe("listStaleSpecCoverage", () => {
  it("returns nothing when every spec's current hash matches the last linked hash", async () => {
    // Build a real hash for specA via the shared helper so the test is honest
    const { hashSpecContent } = await import("@re-cinq/lore-shared");
    const aHash = hashSpecContent(contentFor("A"));
    const pool = makePool([
      { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
      { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
      {
        match: (q) => q.text.includes("WHERE content_type = 'spec'"),
        rows: [{ file_path: specA, content: contentFor("A"), ingested_at: "2026-01-01T00:00:00Z" }],
      },
      {
        match: (q) => q.text.includes("FROM") && q.text.includes("spec_coverage_runs"),
        rows: [{ spec_path: specA, content_hash: aHash, run_at: "2026-01-02T00:00:00Z", linked_by: "cron" }],
      },
      {
        match: (q) => q.text.includes("spec_statements") && q.text.includes("count"),
        rows: [{ spec_path: specA, count: "5" }],
      },
    ]);
    const out = await listStaleSpecCoverage(pool, repo);
    expect(out).toEqual([]);
  });

  it("returns the spec when the current content hash differs from the recorded one", async () => {
    const pool = makePool([
      { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
      { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
      {
        match: (q) => q.text.includes("WHERE content_type = 'spec'"),
        rows: [{ file_path: specB, content: contentFor("B"), ingested_at: "2026-01-01T00:00:00Z" }],
      },
      {
        match: (q) => q.text.includes("FROM") && q.text.includes("spec_coverage_runs"),
        rows: [{
          spec_path: specB,
          content_hash: "old-hash-from-when-the-spec-was-different",
          run_at: "2026-01-02T00:00:00Z",
          linked_by: "cron",
        }],
      },
      {
        match: (q) => q.text.includes("spec_statements") && q.text.includes("count"),
        rows: [{ spec_path: specB, count: "5" }],
      },
    ]);
    const out = await listStaleSpecCoverage(pool, repo);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      spec_path: specB,
      last_linked_hash: "old-hash-from-when-the-spec-was-different",
      last_linked_by: "cron",
      statements_count: 5,
    });
    expect(out[0].current_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the spec when there is no spec_coverage_runs row at all (never linked)", async () => {
    const pool = makePool([
      { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
      { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
      {
        match: (q) => q.text.includes("WHERE content_type = 'spec'"),
        rows: [{ file_path: specC, content: contentFor("C"), ingested_at: "2026-01-01T00:00:00Z" }],
      },
      {
        match: (q) => q.text.includes("FROM") && q.text.includes("spec_coverage_runs"),
        rows: [],
      },
      {
        match: (q) => q.text.includes("spec_statements") && q.text.includes("count"),
        rows: [],
      },
    ]);
    const out = await listStaleSpecCoverage(pool, repo);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      spec_path: specC,
      last_linked_hash: null,
      last_linked_by: null,
      last_linked_at: null,
      statements_count: 0,
    });
  });

  it("returns the spec when its hash is fresh but it has zero statement rows (was rolled back)", async () => {
    const { hashSpecContent } = await import("@re-cinq/lore-shared");
    const aHash = hashSpecContent(contentFor("A"));
    const pool = makePool([
      { match: (q) => q.text.includes("SELECT team FROM lore.repos"), rows: [{ team: "platform" }] },
      { match: (q) => q.text.includes("information_schema.schemata"), rows: [{}] },
      {
        match: (q) => q.text.includes("WHERE content_type = 'spec'"),
        rows: [{ file_path: specA, content: contentFor("A"), ingested_at: "2026-01-01T00:00:00Z" }],
      },
      {
        match: (q) => q.text.includes("FROM") && q.text.includes("spec_coverage_runs"),
        rows: [{ spec_path: specA, content_hash: aHash, run_at: "2026-01-02T00:00:00Z", linked_by: "cron" }],
      },
      {
        match: (q) => q.text.includes("spec_statements") && q.text.includes("count"),
        rows: [{ spec_path: specA, count: "0" }],
      },
    ]);
    const out = await listStaleSpecCoverage(pool, repo);
    expect(out).toHaveLength(1);
    expect(out[0].statements_count).toBe(0);
  });

  it("degrades gracefully when spec_coverage_runs table does not exist (42P01)", async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (text.includes("SELECT team FROM lore.repos")) return { rows: [{ team: "platform" }], rowCount: 1 };
        if (text.includes("information_schema.schemata")) return { rows: [{}], rowCount: 1 };
        if (text.includes("WHERE content_type = 'spec'")) return {
          rows: [{ file_path: specC, content: contentFor("C"), ingested_at: "2026-01-01T00:00:00Z" }],
          rowCount: 1,
        };
        if (text.includes("spec_coverage_runs")) {
          const err = new Error('relation "platform.spec_coverage_runs" does not exist') as Error & { code: string };
          err.code = "42P01";
          throw err;
        }
        if (text.includes("spec_statements")) return { rows: [], rowCount: 0 };
        throw new Error(`unmocked: ${text.slice(0, 80)}`);
      }),
    } as unknown as Pool;
    const out = await listStaleSpecCoverage(pool, repo);
    expect(out).toHaveLength(1);
    expect(out[0].last_linked_hash).toBeNull();
  });
});
