/** Backend-agnostic memory ranking (Reciprocal Rank Fusion + diversification) — pure and driver-free so any backend can fuse its own keyword + vector queries. */

export interface MemorySearchResult {
  key: string;
  value: string;
  score: number;
  agent_id: string;
  source: "memory" | "fact" | "episode" | "graph";
  id?: string;
  confidence?: string;
}

export interface RankedItem {
  key: string;
  value: string;
  agent_id: string;
  source: "memory" | "fact" | "episode" | "graph";
  id?: string;
  confidence?: string;
}

export const RRF_K = 60;

function fusionKey(ranked: RankedItem): string {
  return `${ranked.agent_id}::${ranked.source}::${ranked.key}::${ranked.value}`;
}

export function rrfMerge(lists: RankedItem[][]): MemorySearchResult[] {
  const fused = new Map<string, MemorySearchResult>();

  for (const list of lists) {
    list.forEach((ranked, index) =>
      accumulateRank(fused, ranked, 1 / (RRF_K + index + 1)),
    );
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/** Folds one list's reciprocal-rank contribution into the fused map, creating the entry on first sight. */
function accumulateRank(
  fused: Map<string, MemorySearchResult>,
  ranked: RankedItem,
  contribution: number,
): void {
  const dedupeKey = fusionKey(ranked);
  const existing = fused.get(dedupeKey);

  if (existing) {
    existing.score += contribution;

    return;
  }
  fused.set(dedupeKey, fusedEntry(ranked, contribution));
}

/** A ranked item widened to a search result by attaching its running fusion score. */
function fusedEntry(ranked: RankedItem, score: number): MemorySearchResult {
  return {
    key: ranked.key,
    value: ranked.value,
    agent_id: ranked.agent_id,
    source: ranked.source,
    id: ranked.id,
    confidence: ranked.confidence,
    score,
  };
}

// ── Transfer scoring for cross-repo facts ───────────────────────────

const PORTABLE_KEYWORDS = [
  "error",
  "pattern",
  "gotcha",
  "rule",
  "convention",
  "best-practice",
  "anti-pattern",
];
const LOCAL_KEYWORDS = [
  "config",
  "deploy",
  "url",
  "auth",
  "secret",
  "env",
  "port",
  "hostname",
  "endpoint",
];

export function computeTransferScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0.5;

  for (const kw of PORTABLE_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 0.15;
    }
  }

  for (const kw of LOCAL_KEYWORDS) {
    if (lower.includes(kw)) {
      score -= 0.15;
    }
  }

  return Math.max(0, Math.min(1, score));
}

// ── Diversification: cap results per agent_id::source ────────────────

export function diversify(
  results: MemorySearchResult[],
  limit: number,
  maxPerSource = 3,
): MemorySearchResult[] {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const sourceCounts = new Map<string, number>();
  const out: MemorySearchResult[] = [];

  for (const result of sorted) {
    if (takeUnderCap(sourceCounts, result, maxPerSource)) {
      out.push(result);
    }

    if (out.length >= limit) {
      break;
    }
  }

  return out;
}

/** Counts one result against its agent_id::source bucket and reports whether it still fits under the cap. */
function takeUnderCap(
  sourceCounts: Map<string, number>,
  result: MemorySearchResult,
  maxPerSource: number,
): boolean {
  const sourceKey = `${result.agent_id}::${result.source}`;
  const count = sourceCounts.get(sourceKey) ?? 0;

  if (count >= maxPerSource) {
    return false;
  }
  sourceCounts.set(sourceKey, count + 1);

  return true;
}

function decayStrength(
  memory: {
    created_at: string;
    last_retrieved_at?: string | null;
    half_life_days?: number | null;
  },
  now: number,
): number {
  const halfLife = memory.half_life_days || 60;
  const effectiveDate = memory.last_retrieved_at || memory.created_at;
  const effectiveAgeDays = (now - new Date(effectiveDate).getTime()) / 86400000;

  return Math.pow(0.5, effectiveAgeDays / halfLife);
}

function valueLengthAdjustment(value: string): number {
  if (value.length < 50) {
    return -2;
  }

  return value.length > 500 ? 1 : 0;
}

function keyPrefixAdjustment(key: string): number {
  let adjustment = 0;

  if (key.startsWith("auto-curation/")) {
    adjustment -= 1;
  }

  if (key.startsWith("session-summary/")) {
    adjustment -= 1;
  }

  return adjustment;
}

function keyTopicAdjustment(key: string): number {
  let adjustment = 0;

  if (key.includes("gotcha") || key.includes("decision")) {
    adjustment += 2;
  }

  if (key.includes("convention") || key.includes("pattern")) {
    adjustment += 2;
  }

  return adjustment;
}

function retrievalAdjustment(retrievals: number): number {
  if (retrievals >= 20) {
    return 2;
  }

  return retrievals >= 5 ? 1 : 0;
}

function confidenceAdjustment(confidence: string | null | undefined): number {
  return confidence === "stale" ? -1 : 0;
}

export function scoreImportance(
  memory: {
    key: string;
    value: string;
    created_at: string;
    last_retrieved_at?: string | null;
    half_life_days?: number | null;
    retrieval_count?: number | null;
    confidence?: string | null;
  },
  now: number,
): number {
  const strength = decayStrength(memory, now);
  const score = Math.round(strength * 10) + importanceAdjustments(memory);

  return Math.max(0, Math.min(10, score));
}

/** The additive corrections layered on top of the decayed strength: value length, key prefix, key topic, retrieval count and confidence tier. */
function importanceAdjustments(memory: {
  key: string;
  value: string;
  retrieval_count?: number | null;
  confidence?: string | null;
}): number {
  return (
    valueLengthAdjustment(memory.value) +
    keyPrefixAdjustment(memory.key) +
    keyTopicAdjustment(memory.key) +
    retrievalAdjustment(memory.retrieval_count || 0) +
    confidenceAdjustment(memory.confidence)
  );
}
