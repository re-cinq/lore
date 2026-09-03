import { describe, expect, it } from "vitest";
import {
  InMemoryMemoryLifecycle,
  type MemoryLifecycleRow,
} from "@re-cinq/lore-shared/project/memory/memory-lifecycle-memory.js";
import { importanceDecay, MAX_MEMORIES_PER_AGENT } from "./importance-decay.js";

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

function agedMemories(agentId: string, count: number): MemoryLifecycleRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    agent_id: agentId,
    key: i === 0 ? "gotcha/keep-me" : `session-summary/${i}`,
    value: i === 0 ? "x".repeat(600) : "short",
    version: 1,
    is_deleted: false,
    created_at: daysAgo(90),
    last_retrieved_at: null,
    half_life_days: null,
    retrieval_count: i === 0 ? 40 : 0,
    expires_at: null,
  }));
}

describe("importanceDecay", () => {
  it("evicts only the count above the per-agent cap", async () => {
    const store = new InMemoryMemoryLifecycle({
      memories: agedMemories("agent-1", MAX_MEMORIES_PER_AGENT + 3),
    });

    await importanceDecay(store);

    expect(store.memories.filter((m) => !m.is_deleted)).toHaveLength(
      MAX_MEMORIES_PER_AGENT,
    );
  });

  it("keeps the highest-scoring memory and evicts the least important", async () => {
    const store = new InMemoryMemoryLifecycle({
      memories: agedMemories("agent-1", MAX_MEMORIES_PER_AGENT + 3),
    });

    await importanceDecay(store);

    expect(store.memories.find((m) => m.id === "m0")?.is_deleted).toBe(false);
  });

  it("evicts nothing for an agent under the cap", async () => {
    const store = new InMemoryMemoryLifecycle({
      memories: agedMemories("agent-1", 5),
    });

    const summary = await importanceDecay(store);

    expect({
      alive: store.memories.filter((m) => !m.is_deleted).length,
      summary,
    }).toEqual({ alive: 5, summary: expect.stringContaining("Evicted 0") });
  });

  it("writes one importance-decay audit entry per agent it evicts from", async () => {
    const store = new InMemoryMemoryLifecycle({
      memories: agedMemories("agent-1", MAX_MEMORIES_PER_AGENT + 3),
    });

    await importanceDecay(store);

    expect(store.auditLog).toMatchObject([
      { agentId: "agent-1", operation: "importance-decay" },
    ]);
  });

  it("returns a summary naming memories, facts and stale transitions", async () => {
    const store = new InMemoryMemoryLifecycle({
      memories: agedMemories("agent-1", MAX_MEMORIES_PER_AGENT + 2),
    });

    const summary = await importanceDecay(store);

    expect(summary).toMatch(
      /^Evicted 2 memories, \d+ old facts, \d+ stale transitions$/,
    );
  });
});

describe("importanceDecay — facts", () => {
  const invalidated = (id: string, agentId: string) => ({
    id,
    agent_id: agentId,
    fact_text: `fact ${id}`,
    repo: "re-cinq/lore",
    valid_to: daysAgo(120),
    confidence: "observed",
    created_at: daysAgo(200),
    last_retrieved_at: null,
    half_life_days: null,
    retrieval_count: 0,
  });

  it("reports 0 evicted facts when no agent is over the fact cap", async () => {
    const store = new InMemoryMemoryLifecycle({
      facts: [invalidated("f1", "agent-1"), invalidated("f2", "agent-1")],
    });

    const summary = await importanceDecay(store);

    expect({ summary, remaining: store.facts.length }).toEqual({
      summary: "Evicted 0 memories, 0 old facts, 0 stale transitions",
      remaining: 2,
    });
  });
});
