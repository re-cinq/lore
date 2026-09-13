/**
 * Acceptance tests for the three defects in hybridSearch that the relevance
 * batch (#1922–#1937) fixed in hybridChunkItems but not here:
 *   1. Full-sentence plainto_tsquery (ANDs every word) instead of
 *      websearch_to_tsquery with extracted key terms (ORs distinctive words).
 *   2. No score normalisation — raw RRF values cluster around 1/61.
 *
 * Each test goes through the real hybridSearch entry point with a fake pool
 * so it observes SQL shape and return values without a live Postgres instance.
 *
 * spec: specs/mcp-tools/search-context/spec.md
 */

import { describe, it, expect, vi } from "vitest";

// Non-null embedding so the code takes the hybrid (vector + keyword) path.
vi.mock("@re-cinq/lore-shared", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQueryEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

import { hybridSearch, setPool } from "./db.js";
import type { Pool } from "pg";

function fakePool(...results: Array<{ rows: unknown[] }>): {
  pool: Pool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const queue = [...results];
  const pool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return queue.length > 1 ? queue.shift()! : (queue[0] ?? { rows: [] });
    },
  };
  return { pool: pool as unknown as Pool, calls };
}

// When schema is "org_shared", chunkSchemaOrOrgShared short-circuits without
// a pool query, so the call sequence is: [0] SELECT 1, [1] hybrid search SQL.
const ORG_SHARED = "org_shared";

describe("hybridSearch defects (not yet fixed — must stay red until ported from hybridChunkItems)", () => {
  /**
   * Defect 1: The keyword leg passes the raw natural-language question to
   * plainto_tsquery, which ANDs every lexeme. A full sentence like "how does
   * auto-merge decide to squash" requires a document to contain ALL of those
   * words — almost nothing does, so the keyword leg produces an empty result
   * set and the vector leg alone decides ranking. hybridChunkItems fixes this
   * by calling extractKeyTerms and using websearch_to_tsquery (OR semantics).
   *
   * spec: specs/mcp-tools/search-context/spec.md
   */
  it("keyword leg uses websearch_to_tsquery with extracted key terms, not plainto_tsquery over the whole question", async () => {
    const { pool, calls } = fakePool(
      { rows: [{ ok: 1 }] }, // SELECT 1 health check
      { rows: [] }, // hybrid search result
    );

    setPool(pool);
    await hybridSearch("how does auto-merge decide to squash", ORG_SHARED, 3);

    // The second call (index 1) is the hybrid search SQL.
    const hybridSql = calls[1]?.text ?? "";
    expect(hybridSql).toContain("websearch_to_tsquery");
    expect(hybridSql).not.toContain("plainto_tsquery");
  });

  /**
   * Defect 2: hybridSearch returns raw RRF scores (e.g. 1/61 ≈ 0.016) with no
   * spread, so the caller cannot tell a strong match from a weak one. The same
   * fix applied in hybridChunkItems (normalizeScores) rescales the batch so the
   * top result carries score 1.0 and the rest are proportional.
   *
   * spec: specs/mcp-tools/search-context/spec.md
   */
  it("normalises rrf_score so the highest-ranked result is 1.0 (not a raw 1/61 value)", async () => {
    const rawRows = [
      { id: "1", content: "top result", metadata: {}, rrf_score: 1 / 61 },
      { id: "2", content: "second result", metadata: {}, rrf_score: 1 / 62 },
      { id: "3", content: "third result", metadata: {}, rrf_score: 1 / 63 },
    ];
    const { pool } = fakePool(
      { rows: [{ ok: 1 }] }, // SELECT 1 health check
      { rows: rawRows }, // hybrid search result
    );

    setPool(pool);
    const results = await hybridSearch(
      "auto-merge squash merge",
      ORG_SHARED,
      3,
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.rrf_score).toBe(1.0);
    expect(results[1]?.rrf_score).toBeLessThan(1.0);
    expect(results[2]?.rrf_score).toBeLessThan(results[1]?.rrf_score ?? 1);
  });
});
