import { scoreImportance } from "@re-cinq/lore-shared";
import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";

// Importance decay — evicts low-value memories past a per-agent cap, drops old invalidated facts, and ages unretrieved facts to stale. Moved from the Floor (#1350): pure scoring plus database writes, none of the Floor's three exclusive powers (ADR-024); behaviour unchanged from `memory-lifecycle.ts`, just with the port injected instead of a Floor singleton.

export const MAX_MEMORIES_PER_AGENT = 500;
const MAX_FACTS_PER_AGENT = 2000;
const DECAY_MIN_AGE_DAYS = 30;

export async function importanceDecay(
  memory: MemoryLifecyclePort,
): Promise<string> {
  const agents = await memory.countMemoriesByAgentOverCap(
    MAX_MEMORIES_PER_AGENT,
  );
  // One clock for the whole batch: read per iteration, two agents scored milliseconds apart could rank the same memory differently in one run.
  const now = Date.now();

  let totalEvicted = 0;

  for (const { agent_id, cnt } of agents) {
    const excess = cnt - MAX_MEMORIES_PER_AGENT;

    if (excess <= 0) {
      continue;
    }

    // Twice the excess, so scoring has room to choose rather than just taking the oldest.
    const candidates = await memory.findDecayCandidates(
      agent_id,
      excess * 2,
      DECAY_MIN_AGE_DAYS,
    );
    const scored = candidates
      .map((m) => ({ ...m, importance: scoreImportance(m, now) }))
      .sort((a, b) => a.importance - b.importance);
    const toEvict = scored.slice(0, excess);

    if (toEvict.length === 0) {
      continue;
    }

    const ids = toEvict.map((m) => m.id);

    await memory.softDeleteMemories(ids);
    await memory.writeAuditLog({
      agentId: agent_id,
      operation: "importance-decay",
      metadata: { evicted: ids.length, lowest_score: toEvict[0]?.importance },
    });

    totalEvicted += toEvict.length;
  }

  const factAgents = await memory.countInvalidatedFactsByAgentOverCap(
    MAX_FACTS_PER_AGENT,
    DECAY_MIN_AGE_DAYS,
  );

  let factsEvicted = 0;

  for (const { agent_id, cnt } of factAgents) {
    const excess = cnt - MAX_FACTS_PER_AGENT;

    if (excess <= 0) {
      continue;
    }

    factsEvicted += await memory.deleteOldestInvalidatedFacts(
      agent_id,
      excess,
      DECAY_MIN_AGE_DAYS,
    );
  }

  let staleTransitioned = 0;

  try {
    staleTransitioned = await memory.transitionStaleFacts();
  } catch {
    // Non-fatal, exactly as on the Floor: ageing facts to `stale` is a nicety, and failing the whole run over it would leave the eviction unreported.
  }

  return `Evicted ${totalEvicted} memories, ${factsEvicted} old facts, ${staleTransitioned} stale transitions`;
}
