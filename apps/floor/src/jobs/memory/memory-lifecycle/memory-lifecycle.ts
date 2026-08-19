/**
 * Memory lifecycle — automatic consolidation.
 *
 * The importance-decay half moved to lore-api in #1350: it was scoring plus
 * database writes, needing none of the Floor's three exclusive powers. This
 * half stays for now only because it calls Haiku; #1346 moves it to a station.
 *
 * Consolidation:
 *   Periodically groups related facts from recent episodes and
 *   synthesizes higher-level patterns via Haiku. Stores consolidated
 *   insights as memories, reducing noise in search results.
 *   Inspired by ByteRover's ACE Curator phase.
 */

import { memoryLifecycle } from "../../../kernel/queues.js";
import { Llm } from "@re-cinq/lore-shared";

// ── Config ──────────────────────────────────────────────────────────

const CONSOLIDATION_MIN_FACTS = 5;
const CONSOLIDATION_LOOKBACK_DAYS = 7;

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

    if (!byRepo.has(repo)) {
      byRepo.set(repo, []);
    }
    byRepo.get(repo)!.push(f.fact_text);
  }

  let consolidated = 0;

  for (const [repo, facts] of byRepo) {
    if (facts.length < 3) {
      continue;
    } // need at least 3 facts to consolidate

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

      if (patterns.length === 0) {
        continue;
      }

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
