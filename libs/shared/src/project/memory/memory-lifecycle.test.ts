import { describe, it, expect } from "vitest";
import { PgMemoryLifecycle } from "./memory-lifecycle-pg.js";
import {
  InMemoryMemoryLifecycle,
  type MemoryLifecycleRow,
  type FactRow,
} from "./memory-lifecycle-memory.js";
import type { PgPool } from "../../memory-store.js";

// ── Pg fake pool ─────────────────────────────────────────────────────

function fakePool(responses: Array<{ rows: unknown[] }> = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let i = 0;
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return (responses[i++] ?? { rows: [] }) as { rows: T[] };
    },
  };

  return { pool, calls };
}

const ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

function memRow(over: Partial<MemoryLifecycleRow>): MemoryLifecycleRow {
  return {
    id: "mem-x",
    agent_id: "lore-agent",
    key: "k",
    value: "v",
    version: 1,
    is_deleted: false,
    created_at: ago(1),
    last_retrieved_at: null,
    half_life_days: null,
    retrieval_count: null,
    expires_at: null,
    ...over,
  };
}

function factRow(over: Partial<FactRow>): FactRow {
  return {
    id: "fact-x",
    agent_id: "lore-agent",
    fact_text: "f",
    repo: "octo/repo",
    valid_to: null,
    confidence: "observed",
    created_at: ago(1),
    last_retrieved_at: null,
    half_life_days: null,
    ...over,
  };
}

// ── PgMemoryLifecycle (SQL + params) ─────────────────────────────────

describe("PgMemoryLifecycle memory.memories", () => {
  it("counts memories by agent over the cap", async () => {
    const { pool, calls } = fakePool([{ rows: [{ agent_id: "a1", cnt: 7 }] }]);

    const out = await new PgMemoryLifecycle(pool).countMemoriesByAgentOverCap(
      500,
    );

    expect(out).toEqual([{ agent_id: "a1", cnt: 7 }]);
    expect(calls[0]?.text).toContain("FROM memory.memories");
    expect(calls[0]?.text).toContain("WHERE is_deleted = FALSE");
    expect(calls[0]?.text).toContain("HAVING count(*) > $1");
    expect(calls[0]?.params).toEqual([500]);
  });

  it("selects decay candidates oldest-first with the age interval inlined", async () => {
    const { pool, calls } = fakePool([{ rows: [] }]);

    await new PgMemoryLifecycle(pool).findDecayCandidates("a1", 20, 30);

    expect(calls[0]?.text).toContain("interval '30 days'");
    expect(calls[0]?.text).toContain("ORDER BY created_at ASC");
    expect(calls[0]?.params).toEqual(["a1", 20]);
  });

  it("soft-deletes memories by id array", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).softDeleteMemories(["i1", "i2"]);

    expect(calls[0]?.text).toContain(
      "UPDATE memory.memories SET is_deleted = TRUE",
    );
    expect(calls[0]?.text).toContain("id = ANY($1::uuid[])");
    expect(calls[0]?.params).toEqual([["i1", "i2"]]);
  });

  it("inserts a consolidated memory under the consolidation agent", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).insertConsolidatedMemory(
      "consolidated/x/1",
      "pattern",
    );

    expect(calls[0]?.text).toContain("VALUES ('consolidation', $1, $2, 1)");
    expect(calls[0]?.text).toContain(
      "ON CONFLICT (agent_id, key, version) DO NOTHING",
    );
    expect(calls[0]?.params).toEqual(["consolidated/x/1", "pattern"]);
  });

  it("expires memories via the CTE and parses the count", async () => {
    const { pool, calls } = fakePool([{ rows: [{ count: "4" }] }]);

    const count = await new PgMemoryLifecycle(pool).expireMemories();

    expect(count).toBe(4);
    expect(calls[0]?.text).toContain("UPDATE memory.memories");
    expect(calls[0]?.text).toContain("expires_at < now()");
  });

  it("upserts a version-1 memory overwriting the value on collision", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).upsertMemory({
      agentId: "a1",
      key: "k",
      value: "v",
    });

    expect(calls[0]?.text).toContain(
      "ON CONFLICT (agent_id, key, version) DO UPDATE SET value = EXCLUDED.value",
    );
    expect(calls[0]?.params).toEqual(["a1", "k", "v"]);
  });

  it("appends to an existing memory bumping version on collision", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).appendMemory(
      "lore-agent",
      "review-lessons:r",
      "corr",
    );

    expect(calls[0]?.text).toContain(
      "ON CONFLICT (agent_id, key) DO UPDATE SET value = memory.memories.value",
    );
    expect(calls[0]?.text).toContain("version = memory.memories.version + 1");
    expect(calls[0]?.params).toEqual([
      "lore-agent",
      "review-lessons:r",
      "corr",
    ]);
  });
});

describe("PgMemoryLifecycle memory.facts", () => {
  it("counts invalidated facts by agent over the cap", async () => {
    const { pool, calls } = fakePool([{ rows: [{ agent_id: "a1", cnt: 9 }] }]);

    const out = await new PgMemoryLifecycle(
      pool,
    ).countInvalidatedFactsByAgentOverCap(2000, 30);

    expect(out).toEqual([{ agent_id: "a1", cnt: 9 }]);
    expect(calls[0]?.text).toContain("FROM memory.facts f");
    expect(calls[0]?.text).toContain("f.valid_to < now() - interval '30 days'");
    expect(calls[0]?.params).toEqual([2000]);
  });

  it("deletes the oldest invalidated facts and returns the delete count", async () => {
    const { pool, calls } = fakePool([{ rows: [{ id: "f1" }, { id: "f2" }] }]);

    const deleted = await new PgMemoryLifecycle(
      pool,
    ).deleteOldestInvalidatedFacts(50, 30);

    expect(deleted).toBe(2);
    expect(calls[0]?.text).toContain(
      "DELETE FROM memory.facts WHERE id IN (SELECT id FROM oldest)",
    );
    expect(calls[0]?.params).toEqual([50]);
  });

  it("transitions unretrieved facts to stale and returns the count", async () => {
    const { pool, calls } = fakePool([{ rows: [{ id: "f1" }] }]);

    const n = await new PgMemoryLifecycle(pool).transitionStaleFacts();

    expect(n).toBe(1);
    expect(calls[0]?.text).toContain("SET confidence = 'stale'");
    expect(calls[0]?.text).toContain("confidence NOT IN ('stale', 'verified')");
  });

  it("selects recent valid facts with the lookback and limit inlined", async () => {
    const { pool, calls } = fakePool([
      { rows: [{ fact_text: "f", repo: "octo/repo" }] },
    ]);

    const out = await new PgMemoryLifecycle(pool).findRecentValidFacts(7, 50);

    expect(out).toEqual([{ fact_text: "f", repo: "octo/repo" }]);
    expect(calls[0]?.text).toContain(
      "f.created_at > now() - interval '7 days'",
    );
    expect(calls[0]?.text).toContain("LIMIT 50");
  });
});

describe("PgMemoryLifecycle PR-outcome feedback", () => {
  it("boosts facts and memories with +5 cap-365 arithmetic", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).boostContributors(["f1"], ["m1"]);

    expect(calls[0]?.text).toContain(
      "LEAST(COALESCE(half_life_days, 30) + 5, 365)",
    );
    expect(calls[0]?.params).toEqual([["f1"]]);
    expect(calls[1]?.text).toContain(
      "LEAST(COALESCE(half_life_days, 60) + 5, 365)",
    );
    expect(calls[1]?.params).toEqual([["m1"]]);
  });

  it("penalizes facts and memories with -3 floor-7 arithmetic", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).penalizeContributors(["f1"], ["m1"]);

    expect(calls[0]?.text).toContain(
      "GREATEST(7, COALESCE(half_life_days, 30) - 3)",
    );
    expect(calls[1]?.text).toContain(
      "GREATEST(7, COALESCE(half_life_days, 60) - 3)",
    );
  });

  it("skips the update entirely when an id list is empty", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).boostContributors([], []);

    expect(calls).toHaveLength(0);
  });
});

describe("PgMemoryLifecycle memory.audit_log + episodes", () => {
  it("writes an audit log row with serialized metadata", async () => {
    const { pool, calls } = fakePool();

    await new PgMemoryLifecycle(pool).writeAuditLog({
      agentId: "merge-check",
      operation: "outcome-feedback",
      metadata: { task_id: "t1", action: "boost" },
    });

    expect(calls[0]?.text).toContain(
      "INSERT INTO memory.audit_log (agent_id, operation, metadata)",
    );
    expect(calls[0]?.params).toEqual([
      "merge-check",
      "outcome-feedback",
      JSON.stringify({ task_id: "t1", action: "boost" }),
    ]);
  });

  it("inserts an episode and returns the new id", async () => {
    const { pool, calls } = fakePool([{ rows: [{ id: "ep-1" }] }]);

    const id = await new PgMemoryLifecycle(pool).insertEpisode({
      agentId: "a1",
      content: "c",
      contentHash: "h",
      source: "ci",
      ref: "octo/repo/t1",
    });

    expect(id).toBe("ep-1");
    expect(calls[0]?.text).toContain(
      "ON CONFLICT (agent_id, content_hash) DO NOTHING",
    );
    expect(calls[0]?.params).toEqual(["a1", "c", "h", "ci", "octo/repo/t1"]);
  });

  it("returns null when the episode (agent_id, content_hash) already exists", async () => {
    const { pool } = fakePool([{ rows: [] }]);

    const id = await new PgMemoryLifecycle(pool).insertEpisode({
      agentId: "a1",
      content: "c",
      contentHash: "h",
      source: "ci",
      ref: "r",
    });

    expect(id).toBeNull();
  });
});

// ── InMemoryMemoryLifecycle (behavioral spec) ────────────────────────

describe("InMemoryMemoryLifecycle memories", () => {
  it("counts only live memories per agent over the cap", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      memories: [
        memRow({ id: "a", agent_id: "a1" }),
        memRow({ id: "b", agent_id: "a1" }),
        memRow({ id: "c", agent_id: "a1", is_deleted: true }),
        memRow({ id: "d", agent_id: "a2" }),
      ],
    });

    expect(await dbl.countMemoriesByAgentOverCap(1)).toEqual([
      { agent_id: "a1", cnt: 2 },
    ]);
  });

  it("returns decay candidates older than the age cutoff, oldest first, capped", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      memories: [
        memRow({ id: "young", created_at: ago(5) }),
        memRow({ id: "old1", created_at: ago(40) }),
        memRow({ id: "old2", created_at: ago(60) }),
      ],
    });

    const out = await dbl.findDecayCandidates("lore-agent", 1, 30);

    expect(out.map((m) => m.id)).toEqual(["old2"]);
  });

  it("soft-deletes the named memory ids", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      memories: [memRow({ id: "x" }), memRow({ id: "y" })],
    });

    await dbl.softDeleteMemories(["x"]);

    expect(dbl.memories.find((m) => m.id === "x")?.is_deleted).toBe(true);
    expect(dbl.memories.find((m) => m.id === "y")?.is_deleted).toBe(false);
  });

  it("inserts a consolidated memory once, deduping on key", async () => {
    const dbl = new InMemoryMemoryLifecycle();

    await dbl.insertConsolidatedMemory("consolidated/r/1", "p");
    await dbl.insertConsolidatedMemory("consolidated/r/1", "p-again");

    expect(dbl.memories).toHaveLength(1);
    expect(dbl.memories[0]).toMatchObject({
      agent_id: "consolidation",
      value: "p",
    });
  });

  it("expires only memories whose expires_at has passed", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      memories: [
        memRow({ id: "due", expires_at: ago(1) }),
        memRow({
          id: "future",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        }),
        memRow({ id: "noexpiry" }),
      ],
    });

    expect(await dbl.expireMemories()).toBe(1);
    expect(dbl.memories.find((m) => m.id === "due")?.is_deleted).toBe(true);
    expect(dbl.memories.find((m) => m.id === "future")?.is_deleted).toBe(false);
  });

  it("upserts: overwrites value on (agent,key,v1) collision, else inserts", async () => {
    const dbl = new InMemoryMemoryLifecycle();

    await dbl.upsertMemory({ agentId: "a1", key: "k", value: "first" });
    await dbl.upsertMemory({ agentId: "a1", key: "k", value: "second" });

    expect(dbl.memories).toHaveLength(1);
    expect(dbl.memories[0].value).toBe("second");
  });

  it("appends value and bumps version on (agent,key) collision", async () => {
    const dbl = new InMemoryMemoryLifecycle();

    await dbl.appendMemory("lore-agent", "lessons", "one");
    await dbl.appendMemory("lore-agent", "lessons", "two");

    expect(dbl.memories).toHaveLength(1);
    expect(dbl.memories[0]).toMatchObject({ value: "one\ntwo", version: 2 });
  });
});

describe("InMemoryMemoryLifecycle facts", () => {
  it("counts invalidated facts older than the cutoff over the cap", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      facts: [
        factRow({ id: "f1", valid_to: ago(40) }),
        factRow({ id: "f2", valid_to: ago(50) }),
        factRow({ id: "f3", valid_to: ago(5) }),
        factRow({ id: "f4", valid_to: null }),
      ],
    });

    expect(await dbl.countInvalidatedFactsByAgentOverCap(1, 30)).toEqual([
      { agent_id: "lore-agent", cnt: 2 },
    ]);
  });

  it("deletes the oldest invalidated facts up to the limit", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      facts: [
        factRow({ id: "newer", valid_to: ago(35) }),
        factRow({ id: "older", valid_to: ago(90) }),
      ],
    });

    expect(await dbl.deleteOldestInvalidatedFacts(1, 30)).toBe(1);
    expect(dbl.facts.map((f) => f.id)).toEqual(["newer"]);
  });

  it("transitions unretrieved non-verified live facts to stale", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      facts: [
        factRow({
          id: "stale-me",
          confidence: "observed",
          created_at: ago(40),
          last_retrieved_at: null,
        }),
        factRow({
          id: "verified",
          confidence: "verified",
          created_at: ago(40),
        }),
        factRow({ id: "fresh", confidence: "observed", created_at: ago(5) }),
      ],
    });

    expect(await dbl.transitionStaleFacts()).toBe(1);
    expect(dbl.facts.find((f) => f.id === "stale-me")?.confidence).toBe(
      "stale",
    );
    expect(dbl.facts.find((f) => f.id === "verified")?.confidence).toBe(
      "verified",
    );
  });

  it("returns recent valid facts newest-first within the lookback", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      facts: [
        factRow({ id: "old", valid_to: null, created_at: ago(10) }),
        factRow({
          id: "newer",
          fact_text: "newer",
          valid_to: null,
          created_at: ago(1),
        }),
        factRow({ id: "invalid", valid_to: ago(1), created_at: ago(1) }),
      ],
    });

    const out = await dbl.findRecentValidFacts(7, 50);

    expect(out.map((f) => f.fact_text)).toEqual(["newer"]);
  });
});

describe("InMemoryMemoryLifecycle outcome feedback + audit + episodes", () => {
  it("boosts +5 capped at 365 using table defaults for null half_life", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      facts: [
        factRow({ id: "f1", half_life_days: null }),
        factRow({ id: "f2", half_life_days: 364 }),
      ],
      memories: [memRow({ id: "m1", half_life_days: null })],
    });

    await dbl.boostContributors(["f1", "f2"], ["m1"]);

    expect(dbl.facts.find((f) => f.id === "f1")?.half_life_days).toBe(35);
    expect(dbl.facts.find((f) => f.id === "f2")?.half_life_days).toBe(365);
    expect(dbl.memories.find((m) => m.id === "m1")?.half_life_days).toBe(65);
  });

  it("penalizes -3 floored at 7 using table defaults for null half_life", async () => {
    const dbl = new InMemoryMemoryLifecycle({
      facts: [factRow({ id: "f1", half_life_days: 8 })],
      memories: [memRow({ id: "m1", half_life_days: null })],
    });

    await dbl.penalizeContributors(["f1"], ["m1"]);

    expect(dbl.facts.find((f) => f.id === "f1")?.half_life_days).toBe(7);
    expect(dbl.memories.find((m) => m.id === "m1")?.half_life_days).toBe(57);
  });

  it("records audit log entries", async () => {
    const dbl = new InMemoryMemoryLifecycle();

    await dbl.writeAuditLog({
      agentId: "merge-check",
      operation: "outcome-feedback",
      metadata: { n: 1 },
    });

    expect(dbl.auditLog).toEqual([
      {
        agentId: "merge-check",
        operation: "outcome-feedback",
        metadata: { n: 1 },
      },
    ]);
  });

  it("dedups episodes on (agent_id, content_hash), returning null on the dup", async () => {
    const dbl = new InMemoryMemoryLifecycle();

    const first = await dbl.insertEpisode({
      agentId: "a1",
      content: "c",
      contentHash: "h",
      source: "ci",
      ref: "r",
    });
    const second = await dbl.insertEpisode({
      agentId: "a1",
      content: "c2",
      contentHash: "h",
      source: "ci",
      ref: "r",
    });

    expect(first).toBe("episode-1");
    expect(second).toBeNull();
    expect(dbl.episodes).toHaveLength(1);
  });
});
