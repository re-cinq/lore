import { describe, it, expect, vi } from "vitest";

vi.mock("@re-cinq/lore-shared", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQueryEmbedding: vi.fn(async () => null),
}));

import { hybridSearch, setPool } from "./db.js";
import type { Pool } from "pg";

/** Results are consumed in order per query; the last one is sticky. */
function fakePool(...results: Array<{ rows: any[] }>): {
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

describe("hybridSearch schema resolution", () => {
  it("searches a provisioned team schema directly", async () => {
    const { pool, calls } = fakePool(
      { rows: [{ ok: 1 }] },
      { rows: [{ table_schema: "infra" }] },
      { rows: [{ id: "1", content: "x", metadata: {}, rrf_score: 0.4 }] },
    );

    setPool(pool);
    const results = await hybridSearch("q", "infra", 5);

    expect(calls[1]?.text).toContain("table_name = 'chunks'");
    expect(calls[2]?.text).toContain("FROM infra.chunks");
    expect(results).toEqual([
      { id: "1", content: "x", metadata: {}, rrf_score: 0.4 },
    ]);
  });

  it("falls back to org_shared for an unprovisioned schema", async () => {
    const { pool, calls } = fakePool(
      { rows: [{ ok: 1 }] },
      { rows: [] },
      { rows: [] },
    );

    setPool(pool);
    await hybridSearch("q", "ghost_team", 5);

    expect(calls[2]?.text).toContain("FROM org_shared.chunks");
  });

  it("falls back to org_shared for an injection-shaped schema without an existence check", async () => {
    const { pool, calls } = fakePool({ rows: [{ ok: 1 }] }, { rows: [] });

    setPool(pool);
    await hybridSearch("q", "x; DROP SCHEMA", 5);

    expect(calls[1]?.text).toContain("FROM org_shared.chunks");
  });
});
