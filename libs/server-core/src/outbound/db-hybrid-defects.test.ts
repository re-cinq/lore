import { describe, it, expect, vi } from "vitest";

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

const ORG_SHARED = "org_shared";

describe("hybridSearch defects (not yet fixed — must stay red until ported from hybridChunkItems)", () => {
  it("keyword leg uses websearch_to_tsquery with extracted key terms, not plainto_tsquery over the whole question", async () => {
    const { pool, calls } = fakePool({ rows: [{ ok: 1 }] }, { rows: [] });

    setPool(pool);
    await hybridSearch("how does auto-merge decide to squash", ORG_SHARED, 3);

    const hybridSql = calls[1]?.text ?? "";

    expect(hybridSql).toContain("websearch_to_tsquery");
    expect(hybridSql).not.toContain("plainto_tsquery");
  });

  it("normalises rrf_score so the highest-ranked result is 1.0 (not a raw 1/61 value)", async () => {
    const rawRows = [
      { id: "1", content: "top result", metadata: {}, rrf_score: 1 / 61 },
      {
        id: "2",
        content: "second result",
        metadata: {},
        rrf_score: 1 / 62,
      },
      { id: "3", content: "third result", metadata: {}, rrf_score: 1 / 63 },
    ];
    const { pool } = fakePool({ rows: [{ ok: 1 }] }, { rows: rawRows });

    setPool(pool);
    const results = await hybridSearch(
      "auto-merge squash merge",
      ORG_SHARED,
      3,
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.rrf_score).toBe(1.0);
    expect(results[2]?.rrf_score).toBeLessThan(results[1]?.rrf_score ?? 1);
  });
});
