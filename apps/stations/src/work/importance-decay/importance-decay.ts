import { scoreImportance } from "@re-cinq/lore-shared";
import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";

// Importance decay — evicts low-value memories past a per-agent cap, drops old invalidated facts, and ages unretrieved facts to stale. Moved from the Floor (#1350): pure scoring plus database writes, none of the Floor's three exclusive powers (ADR-024); behaviour unchanged from `memory-lifecycle.ts`, just with the port injected instead of a Floor singleton.

export const MAX_MEMORIES_PER_AGENT = 500;
const MAX_FACTS_PER_AGENT = 2000;
const DECAY_MIN_AGE_DAYS = 30;

async function evictExcessMemoriesForAgent(
  memory: MemoryLifecyclePort,
  agentId: string,
  excess: number,
  now: number,
): Promise<number> {
  // Twice the excess, so scoring has room to choose rather than just taking the oldest.
  const candidates = await memory.findDecayCandidates(
    agentId,
    excess * 2,
    DECAY_MIN_AGE_DAYS,
  );
  const scored = candidates
    .map((m) => ({ ...m, importance: scoreImportance(m, now) }))
    .sort((a, b) => a.importance - b.importance);
  const toEvict = scored.slice(0, excess);

  if (toEvict.length === 0) {
    return 0;
  }

  const ids = toEvict.map((m) => m.id);

  await memory.softDeleteMemories(ids);
  await memory.writeAuditLog({
    agentId,
    operation: "importance-decay",
    metadata: { evicted: ids.length, lowest_score: toEvict[0]?.importance },
  });

  return toEvict.length;
}

async function evictExcessMemories(
  memory: MemoryLifecyclePort,
  now: number,
): Promise<number> {
  const agents = await memory.countMemoriesByAgentOverCap(
    MAX_MEMORIES_PER_AGENT,
  );
  let totalEvicted = 0;

  for (const { agent_id, cnt } of agents) {
    const excess = cnt - MAX_MEMORIES_PER_AGENT;

    if (excess > 0) {
      totalEvicted += await evictExcessMemoriesForAgent(
        memory,
        agent_id,
        excess,
        now,
      );
    }
  }

  return totalEvicted;
}

async function evictExcessFacts(memory: MemoryLifecyclePort): Promise<number> {
  const factAgents = await memory.countInvalidatedFactsByAgentOverCap(
    MAX_FACTS_PER_AGENT,
    DECAY_MIN_AGE_DAYS,
  );
  let factsEvicted = 0;

  for (const { agent_id, cnt } of factAgents) {
    const excess = cnt - MAX_FACTS_PER_AGENT;

    if (excess > 0) {
      factsEvicted += await memory.deleteOldestInvalidatedFacts(
        agent_id,
        excess,
        DECAY_MIN_AGE_DAYS,
      );
    }
  }

  return factsEvicted;
}

// Non-fatal, exactly as on the Floor: ageing facts to `stale` is a nicety, and failing the whole run over it would leave the eviction unreported.
async function transitionStaleFactsSafely(
  memory: MemoryLifecyclePort,
): Promise<number> {
  try {
    return await memory.transitionStaleFacts();
  } catch {
    return 0;
  }
}

export async function importanceDecay(
  memory: MemoryLifecyclePort,
): Promise<string> {
  // One clock for the whole batch: read per iteration, two agents scored milliseconds apart could rank the same memory differently in one run.
  const now = Date.now();

  const totalEvicted = await evictExcessMemories(memory, now);
  const factsEvicted = await evictExcessFacts(memory);
  const staleTransitioned = await transitionStaleFactsSafely(memory);

  return `Evicted ${totalEvicted} memories, ${factsEvicted} old facts, ${staleTransitioned} stale transitions`;
}
