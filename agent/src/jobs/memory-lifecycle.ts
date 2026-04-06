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

import { query } from "../db.js";
import { callLLM } from "../anthropic.js";

// ── Config ──────────────────────────────────────────────────────────

const MAX_MEMORIES_PER_AGENT = 500;
const MAX_FACTS_PER_AGENT = 2000;
const DECAY_MIN_AGE_DAYS = 30;
const CONSOLIDATION_MIN_FACTS = 5;
const CONSOLIDATION_LOOKBACK_DAYS = 7;

// ── Importance scoring ──────────────────────────────────────────────

/**
 * Score a memory's importance (0-10) based on:
 *   - Recency: newer = higher (decays over 180 days)
 *   - Content length: longer, more detailed = higher
 *   - Key pattern: session-summary < deployment-gotchas < explicit memories
 */
function scoreImportance(memory: {
  key: string;
  value: string;
  created_at: string;
}): number {
  let score = 5; // baseline

  // Recency: -1 per 30 days of age, min 0
  const ageDays = (Date.now() - new Date(memory.created_at).getTime()) / 86400000;
  score -= Math.min(5, Math.floor(ageDays / 30));

  // Content richness: short = low value
  if (memory.value.length < 50) score -= 2;
  else if (memory.value.length > 500) score += 1;

  // Key-based importance boost
  if (memory.key.startsWith("auto-curation/")) score -= 1; // auto-generated, lower value
  if (memory.key.startsWith("session-summary/")) score -= 1; // ephemeral
  if (memory.key.includes("gotcha") || memory.key.includes("decision")) score += 2;
  if (memory.key.includes("convention") || memory.key.includes("pattern")) score += 2;

  return Math.max(0, Math.min(10, score));
}

// ── Importance decay job ────────────────────────────────────────────

export async function importanceDecayJob(): Promise<string> {
  // Find agents with too many memories
  const agents = await query<{ agent_id: string; cnt: number }>(
    `SELECT agent_id, count(*)::int AS cnt
     FROM memory.memories
     WHERE is_deleted = FALSE
     GROUP BY agent_id
     HAVING count(*) > $1`,
    [MAX_MEMORIES_PER_AGENT],
  );

  let totalEvicted = 0;

  for (const { agent_id, cnt } of agents) {
    const excess = cnt - MAX_MEMORIES_PER_AGENT;
    if (excess <= 0) continue;

    // Get old memories (older than DECAY_MIN_AGE_DAYS)
    const candidates = await query<{ id: string; key: string; value: string; created_at: string }>(
      `SELECT id, key, value, created_at
       FROM memory.memories
       WHERE agent_id = $1 AND is_deleted = FALSE
         AND created_at < now() - interval '${DECAY_MIN_AGE_DAYS} days'
       ORDER BY created_at ASC
       LIMIT $2`,
      [agent_id, excess * 2], // fetch double to have room for scoring
    );

    // Score and sort by importance (ascending = least important first)
    const scored = candidates
      .map((m) => ({ ...m, importance: scoreImportance(m) }))
      .sort((a, b) => a.importance - b.importance);

    // Evict the least important up to the excess count
    const toEvict = scored.slice(0, excess);
    if (toEvict.length === 0) continue;

    const ids = toEvict.map((m) => m.id);
    await query(
      `UPDATE memory.memories SET is_deleted = TRUE
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    // Audit log
    await query(
      `INSERT INTO memory.audit_log (agent_id, operation, metadata)
       VALUES ($1, 'importance-decay', $2)`,
      [agent_id, JSON.stringify({ evicted: ids.length, lowest_score: toEvict[0]?.importance })],
    );

    totalEvicted += toEvict.length;
  }

  // Also evict old invalidated facts beyond cap
  const factAgents = await query<{ agent_id: string; cnt: number }>(
    `SELECT COALESCE(m.agent_id, e.agent_id) AS agent_id, count(*)::int AS cnt
     FROM memory.facts f
     LEFT JOIN memory.memories m ON m.id = f.memory_id
     LEFT JOIN memory.episodes e ON e.id = f.episode_id
     WHERE f.valid_to IS NOT NULL
       AND f.valid_to < now() - interval '${DECAY_MIN_AGE_DAYS} days'
     GROUP BY COALESCE(m.agent_id, e.agent_id)
     HAVING count(*) > $1`,
    [MAX_FACTS_PER_AGENT],
  );

  let factsEvicted = 0;
  for (const { agent_id, cnt } of factAgents) {
    const excess = cnt - MAX_FACTS_PER_AGENT;
    if (excess <= 0) continue;

    const result = await query<{ count: string }>(
      `WITH oldest AS (
         SELECT id FROM memory.facts
         WHERE valid_to IS NOT NULL
           AND valid_to < now() - interval '${DECAY_MIN_AGE_DAYS} days'
         ORDER BY valid_to ASC
         LIMIT $1
       )
       DELETE FROM memory.facts WHERE id IN (SELECT id FROM oldest)
       RETURNING id`,
      [excess],
    );
    factsEvicted += result.length;
  }

  if (totalEvicted > 0 || factsEvicted > 0) {
    console.log(`[job] importance-decay: evicted ${totalEvicted} memories, ${factsEvicted} old facts`);
  }

  return `Evicted ${totalEvicted} memories, ${factsEvicted} old facts`;
}

// ── Consolidation job ───────────────────────────────────────────────

export async function consolidationJob(): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Skipped: no ANTHROPIC_API_KEY";
  }

  // Get recent facts from the last N days that haven't been consolidated
  const recentFacts = await query<{ fact_text: string; repo: string }>(
    `SELECT f.fact_text, COALESCE(e.ref, 'unknown') AS repo
     FROM memory.facts f
     LEFT JOIN memory.episodes e ON e.id = f.episode_id
     WHERE f.valid_to IS NULL
       AND f.created_at > now() - interval '${CONSOLIDATION_LOOKBACK_DAYS} days'
     ORDER BY f.created_at DESC
     LIMIT 50`,
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
      const result = await callLLM({
        prompt: `Here are ${facts.length} recent facts extracted from agent sessions working on ${repo}. Identify 1-3 higher-level patterns or insights that emerge from these facts. Each pattern should be actionable — something future agents should know.\n\nFacts:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nReturn each pattern on its own line, prefixed with "PATTERN: ". If no meaningful patterns emerge, respond with "NONE".`,
        systemPrompt: "You are a knowledge consolidation engine. Extract reusable patterns from raw facts.",
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
        await query(
          `INSERT INTO memory.memories (agent_id, key, value, version)
           VALUES ('consolidation', $1, $2, 1)
           ON CONFLICT (agent_id, key, version) DO NOTHING`,
          [key, pattern],
        );
        consolidated++;
      }
    } catch {
      // Best effort — don't crash the job
    }
  }

  if (consolidated > 0) {
    console.log(`[job] consolidation: created ${consolidated} pattern memories from ${recentFacts.length} facts`);
  }

  return `Consolidated ${consolidated} patterns from ${recentFacts.length} facts`;
}
