/** Memory lifecycle — automatic consolidation: periodically groups related facts and synthesizes higher-level patterns via Haiku. The importance-decay half moved to lore-api in #1350; this half stays only because it calls Haiku (#1346 moves it to a station). */

import { memoryLifecycle } from "../../../outbound/queues.js";
import { Llm } from "@re-cinq/lore-shared";

// ── Config ──────────────────────────────────────────────────────────

const CONSOLIDATION_MIN_FACTS = 5;
const CONSOLIDATION_LOOKBACK_DAYS = 7;

/** Pull the `PATTERN: ` lines out of the model's reply. Extracted so tests exercise the real thing rather than re-implementing it inline (#1374); the length floor drops one-word non-answers, and "NONE" produces nothing (no prefix). */
export function parseConsolidationPatterns(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("PATTERN: "))
    .map((line) => line.replace("PATTERN: ", "").trim())
    .filter((pattern) => pattern.length > 10);
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

  const consolidated = await consolidateAll(groupFactsByRepo(recentFacts));

  if (consolidated > 0) {
    console.log(
      `[job] consolidation: created ${consolidated} pattern memories from ${recentFacts.length} facts`,
    );
  }

  return `Consolidated ${consolidated} patterns from ${recentFacts.length} facts`;
}

/** Groups facts by their top two path segments so consolidation stays scoped to one repo's context. */
function groupFactsByRepo(
  facts: Array<{ repo: string; fact_text: string }>,
): Map<string, string[]> {
  const byRepo = new Map<string, string[]>();

  for (const f of facts) {
    const segments = f.repo.split("/");
    const repo = segments.slice(0, 2).join("/") || "unknown";
    const bucket = byRepo.get(repo) ?? [];

    bucket.push(f.fact_text);
    byRepo.set(repo, bucket);
  }

  return byRepo;
}

/** Consolidates every repo bucket that clears the 3-fact floor, returning how many pattern memories landed. */
async function consolidateAll(byRepo: Map<string, string[]>): Promise<number> {
  let consolidated = 0;

  for (const [repo, facts] of byRepo) {
    // need at least 3 facts to consolidate
    if (facts.length < 3) {
      continue;
    }

    consolidated += await consolidateRepoFacts(repo, facts);
  }

  return consolidated;
}

/** Asks Haiku for patterns across one repo's facts and stores whatever it finds; best effort — a failure here just consolidates zero for this repo. */
async function consolidateRepoFacts(
  repo: string,
  facts: string[],
): Promise<number> {
  try {
    const patterns = await extractPatterns(repo, facts);

    return patterns.length === 0
      ? 0
      : await storeConsolidatedPatterns(repo, patterns);
  } catch {
    return 0;
  }
}

async function extractPatterns(
  repo: string,
  facts: string[],
): Promise<string[]> {
  const result = await Llm.instance.complete({
    prompt: consolidationPrompt(repo, facts),
    systemPrompt:
      "You are a knowledge consolidation engine. Extract reusable patterns from raw facts.",
    maxTokens: 512,
    jobName: "consolidation",
  });

  return parseConsolidationPatterns(result.text);
}

function consolidationPrompt(repo: string, facts: string[]): string {
  return `Here are ${facts.length} recent facts extracted from agent sessions working on ${repo}. Identify 1-3 higher-level patterns or insights that emerge from these facts. Each pattern should be actionable — something future agents should know.\n\nFacts:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nReturn each pattern on its own line, prefixed with "PATTERN: ". If no meaningful patterns emerge, respond with "NONE".`;
}

/** Store each extracted pattern as a memory; best effort — a partial store still counts what landed. */
async function storeConsolidatedPatterns(
  repo: string,
  patterns: string[],
): Promise<number> {
  let stored = 0;

  try {
    for (const pattern of patterns) {
      const key = `consolidated/${repo.replace(/\//g, "-")}/${Date.now()}`;

      await memoryLifecycle().insertConsolidatedMemory(key, pattern);
      stored++;
    }
  } catch {
    // Best effort — don't crash the job
  }

  return stored;
}
