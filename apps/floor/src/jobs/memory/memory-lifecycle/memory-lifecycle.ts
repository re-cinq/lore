/**
 * Memory lifecycle — importance-based decay + automatic consolidation.
 *
 * Importance decay:
 *   Scores memories by recency, access frequency, and content quality.
 *   Evicts old, low-importance entries beyond a per-agent cap.
 *   Inspired by agentmemory's Ebbinghaus-style forgetting.
 *
 * Consolidation:
 *   Periodically groups related facts from recent episodes and
 *   synthesizes higher-level patterns via Haiku. Stores consolidated
 *   insights as memories, reducing noise in search results.
 *   Inspired by ByteRover's ACE Curator phase.
 */

import { scoreImportance } from "@re-cinq/lore-shared";
import { memoryLifecycle } from "../../../kernel/queues.js";
import { Llm } from "@re-cinq/lore-shared";

// ── Config ──────────────────────────────────────────────────────────

const MAX_MEMORIES_PER_AGENT = 500;
const MAX_FACTS_PER_AGENT = 2000;
const DECAY_MIN_AGE_DAYS = 30;
const CONSOLIDATION_MIN_FACTS = 5;
const CONSOLIDATION_LOOKBACK_DAYS = 7;

// ── Importance decay job ────────────────────────────────────────────

export async function importanceDecayJob(): Promise<string> {
  // Find agents with too many memories
  const agents = await memoryLifecycle().countMemoriesByAgentOverCap(
    MAX_MEMORIES_PER_AGENT,
  );

  let totalEvicted = 0;

  for (const { agent_id, cnt } of agents) {
    const excess = cnt - MAX_MEMORIES_PER_AGENT;
    if (excess <= 0) continue;

    // Get old memories (older than DECAY_MIN_AGE_DAYS), fetch double to have room for scoring
    const candidates = await memoryLifecycle().findDecayCandidates(
      agent_id,
      excess * 2,
      DECAY_MIN_AGE_DAYS,
    );

    // Score and sort by importance (ascending = least important first)
    const scored = candidates
      .map((m) => ({ ...m, importance: scoreImportance(m, Date.now()) }))
      .sort((a, b) => a.importance - b.importance);

    // Evict the least important up to the excess count
    const toEvict = scored.slice(0, excess);
    if (toEvict.length === 0) continue;

    const ids = toEvict.map((m) => m.id);
    await memoryLifecycle().softDeleteMemories(ids);

    // Audit log
    await memoryLifecycle().writeAuditLog({
      agentId: agent_id,
      operation: "importance-decay",
      metadata: { evicted: ids.length, lowest_score: toEvict[0]?.importance },
    });

    totalEvicted += toEvict.length;
  }

  // Also evict old invalidated facts beyond cap
  const factAgents =
    await memoryLifecycle().countInvalidatedFactsByAgentOverCap(
      MAX_FACTS_PER_AGENT,
      DECAY_MIN_AGE_DAYS,
    );

  let factsEvicted = 0;
  for (const { cnt } of factAgents) {
    const excess = cnt - MAX_FACTS_PER_AGENT;
    if (excess <= 0) continue;

    factsEvicted += await memoryLifecycle().deleteOldestInvalidatedFacts(
      excess,
      DECAY_MIN_AGE_DAYS,
    );
  }

  // Transition unretrieved facts to 'stale' after 30 days
  let staleTransitioned = 0;
  try {
    staleTransitioned = await memoryLifecycle().transitionStaleFacts();
  } catch {
    // Non-fatal
  }

  if (totalEvicted > 0 || factsEvicted > 0 || staleTransitioned > 0) {
    console.log(
      `[job] importance-decay: evicted ${totalEvicted} memories, ${factsEvicted} old facts, transitioned ${staleTransitioned} facts to stale`,
    );
  }

  return `Evicted ${totalEvicted} memories, ${factsEvicted} old facts, ${staleTransitioned} stale transitions`;
}

// ── Consolidation job ───────────────────────────────────────────────

export async function consolidationJob(): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Skipped: no ANTHROPIC_API_KEY";
  }

  // Get recent facts from the last N days that haven't been consolidated
  const recentFacts = await memoryLifecycle().findRecentValidFacts(
    CONSOLIDATION_LOOKBACK_DAYS,
    50,
  );

  if (recentFacts.length < CONSOLIDATION_MIN_FACTS) {
    return `Skipped: only ${recentFacts.length} recent facts (need ${CONSOLIDATION_MIN_FACTS})`;
  }

  // Group facts by repo for context-aware consolidation
  const byRepo = new Map<string, string[]>();
  for (const f of recentFacts) {
    const repo = f.repo.split("/").slice(0, 2).join("/") || "unknown";
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo)!.push(f.fact_text);
  }

  let consolidated = 0;

  for (const [repo, facts] of byRepo) {
    if (facts.length < 3) continue; // need at least 3 facts to consolidate

    try {
      const result = await Llm.instance.complete({
        prompt: `Here are ${facts.length} recent facts extracted from agent sessions working on ${repo}. Identify 1-3 higher-level patterns or insights that emerge from these facts. Each pattern should be actionable — something future agents should know.\n\nFacts:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nReturn each pattern on its own line, prefixed with "PATTERN: ". If no meaningful patterns emerge, respond with "NONE".`,
        systemPrompt:
          "You are a knowledge consolidation engine. Extract reusable patterns from raw facts.",
        maxTokens: 512,
        jobName: "consolidation",
      });

      const patterns = result.text
        .split("\n")
        .filter((line) => line.startsWith("PATTERN: "))
        .map((line) => line.replace("PATTERN: ", "").trim())
        .filter((p) => p.length > 10);

      if (patterns.length === 0) continue;

      // Store each pattern as a memory
      for (const pattern of patterns) {
        const key = `consolidated/${repo.replace(/\//g, "-")}/${Date.now()}`;
        await memoryLifecycle().insertConsolidatedMemory(key, pattern);
        consolidated++;
      }
    } catch {
      // Best effort — don't crash the job
    }
  }

  if (consolidated > 0) {
    console.log(
      `[job] consolidation: created ${consolidated} pattern memories from ${recentFacts.length} facts`,
    );
  }

  return `Consolidated ${consolidated} patterns from ${recentFacts.length} facts`;
}
