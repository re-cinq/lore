import { describe, it, expect, vi, afterEach } from "vitest";
import { FakeLlm, Llm } from "@re-cinq/lore-shared";
import type { PgPool } from "@re-cinq/lore-shared";

vi.mock("../../platform/db.js", () => ({
  getQueryEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

import { extractFacts, extractFactsFromEpisode } from "./facts.js";

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface Script {
  match: RegExp;
  rows: Record<string, unknown>[];
}

function scriptedPool(scripts: Script[]) {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const hit = scripts.find((s) => s.match.test(sql));

    return { rows: hit ? hit.rows : [] };
  });

  return { query, calls };
}

function asPool(pool: { query: unknown }): PgPool {
  return pool as unknown as PgPool;
}

afterEach(() => {
  Llm.reset();
});

describe("extractFacts contradiction detection", () => {
  it("records a conflict and invalidates the high-cosine existing fact", async () => {
    Llm.setInstance(new FakeLlm({ text: '["New contradicting fact"]' }));

    const pool = scriptedPool([
      {
        match: /SELECT agent_id FROM memory\.memories/,
        rows: [{ agent_id: "agent-7" }],
      },
      {
        match: /INSERT INTO memory\.facts \(memory_id/,
        rows: [{ id: "new-fact-1" }],
      },
      {
        match: /AS similarity/,
        rows: [
          {
            id: "old-fact-1",
            fact_text: "CI uses GitHub Actions",
            similarity: 0.95,
          },
        ],
      },
    ]);

    await extractFacts("mem-1", "some memory value", asPool(pool));

    const findSimilar = pool.calls.find((c) => /AS similarity/.test(c.sql));

    expect(findSimilar?.params).toEqual(["[0.1,0.2,0.3]", "new-fact-1", 0.92]);

    const conflict = pool.calls.find((c) =>
      /INSERT INTO memory\.fact_conflicts/.test(c.sql),
    );

    expect(conflict?.params).toEqual(["old-fact-1", "new-fact-1", 0.95]);

    const invalidate = pool.calls.find((c) =>
      /UPDATE memory\.facts/.test(c.sql),
    );

    expect(invalidate?.sql).toMatch(
      /SET valid_to = now\(\), invalidated_by = \$1/,
    );
    expect(invalidate?.params).toEqual(["new-fact-1", "old-fact-1"]);
  });
});

describe("extractFacts LLM failure", () => {
  it("resolves without throwing and writes nothing when the extraction LLM rejects", async () => {
    vi.useFakeTimers();

    const rejecting = new FakeLlm();

    rejecting.complete = () => Promise.reject(new Error("extraction LLM down"));
    Llm.setInstance(rejecting);

    const pool = scriptedPool([]);
    const run = extractFacts("mem-1", "some memory value", asPool(pool));

    await vi.runAllTimersAsync();

    await expect(run).resolves.toBeUndefined();
    expect(pool.calls).toHaveLength(0);

    vi.useRealTimers();
  });
});

describe("extractFacts confidence", () => {
  it("inserts the fact with an inferred confidence literal", async () => {
    Llm.setInstance(new FakeLlm({ text: '["Fact one about auth"]' }));

    const pool = scriptedPool([
      {
        match: /SELECT agent_id FROM memory\.memories/,
        rows: [{ agent_id: null }],
      },
      {
        match: /INSERT INTO memory\.facts \(memory_id/,
        rows: [{ id: "new-fact-1" }],
      },
    ]);

    await extractFacts("mem-42", "auth is done with JWT", asPool(pool));

    const insert = pool.calls.find((c) =>
      /INSERT INTO memory\.facts \(memory_id/.test(c.sql),
    );

    expect(insert?.sql).toMatch(/confidence/);
    expect(insert?.sql).toMatch(/'inferred'/);
    expect(insert?.params).toEqual([
      "mem-42",
      "Fact one about auth",
      "[0.1,0.2,0.3]",
    ]);
  });
});

describe("extractFactsFromEpisode confidence", () => {
  it("omits confidence so the fact falls to the observed DB default", async () => {
    Llm.setInstance(new FakeLlm({ text: '["Episode fact"]' }));

    const pool = scriptedPool([
      {
        match: /INSERT INTO memory\.facts \(episode_id/,
        rows: [{ id: "ep-fact-1" }],
      },
    ]);

    await extractFactsFromEpisode(
      "ep-1",
      "the episode text",
      "agent-7",
      asPool(pool),
    );

    const insert = pool.calls.find((c) =>
      /INSERT INTO memory\.facts \(episode_id/.test(c.sql),
    );

    expect(insert?.sql).not.toMatch(/confidence/);
    expect(insert?.sql).not.toMatch(/inferred|observed/);
    expect(insert?.params).toEqual(["ep-1", "Episode fact", "[0.1,0.2,0.3]"]);
  });
});

describe("extractFacts fact isolation", () => {
  it("continues storing remaining facts when one insert fails", async () => {
    Llm.setInstance(
      new FakeLlm({ text: '["Fact A fails", "Fact B succeeds"]' }),
    );

    let insertCalls = 0;
    const query = async (sql: string) => {
      if (/SELECT agent_id FROM memory\.memories/.test(sql)) {
        return { rows: [{ agent_id: null }] };
      }

      if (!/INSERT INTO memory\.facts \(memory_id/.test(sql)) {
        return { rows: [] };
      }

      insertCalls++;

      if (insertCalls === 1) {
        return Promise.reject(new Error("insert failed"));
      }

      return { rows: [{ id: "fact-b-id" }] };
    };
    const pool = asPool({ query });

    await expect(
      extractFacts("mem-1", "some memory value", pool),
    ).resolves.toBeUndefined();

    expect(insertCalls).toBe(2);
  });
});

describe("extractFacts null embedding", () => {
  it("skips the contradiction check when no embedding is returned", async () => {
    const db = await import("../../platform/db.js");

    vi.mocked(db.getQueryEmbedding).mockResolvedValueOnce(null);
    Llm.setInstance(new FakeLlm({ text: '["Fact without embedding"]' }));

    const pool = scriptedPool([
      {
        match: /SELECT agent_id FROM memory\.memories/,
        rows: [{ agent_id: null }],
      },
      {
        match: /INSERT INTO memory\.facts \(memory_id/,
        rows: [{ id: "fact-1" }],
      },
    ]);

    await extractFacts("mem-1", "some memory value", asPool(pool));

    const insert = pool.calls.find((c) =>
      /INSERT INTO memory\.facts \(memory_id/.test(c.sql),
    );

    expect(insert?.params).toEqual(["mem-1", "Fact without embedding", null]);
    expect(pool.calls.some((c) => /AS similarity/.test(c.sql))).toBe(false);
  });
});
