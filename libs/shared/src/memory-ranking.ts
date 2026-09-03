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
    list.forEach((ranked, index) => {
      const rank = index + 1;
      const contribution = 1 / (RRF_K + rank);
      const dedupeKey = fusionKey(ranked);
      const existing = fused.get(dedupeKey);

      if (existing) {
        existing.score += contribution;

        return;
      }
      fused.set(dedupeKey, {
        key: ranked.key,
        value: ranked.value,
        agent_id: ranked.agent_id,
        source: ranked.source,
        id: ranked.id,
        confidence: ranked.confidence,
        score: contribution,
      });
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
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

  for (const r of sorted) {
    const sourceKey = `${r.agent_id}::${r.source}`;
    const count = sourceCounts.get(sourceKey) ?? 0;

    if (count >= maxPerSource) {
      continue;
    }
    sourceCounts.set(sourceKey, count + 1);
    out.push(r);

    if (out.length >= limit) {
      break;
    }
  }

  return out;
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
  const halfLife = memory.half_life_days || 60;
  const effectiveDate = memory.last_retrieved_at || memory.created_at;
  const effectiveAgeDays = (now - new Date(effectiveDate).getTime()) / 86400000;
  const strength = Math.pow(0.5, effectiveAgeDays / halfLife);
  let score = Math.round(strength * 10);

  const isShortValue = memory.value.length < 50;

  if (isShortValue) {
    score -= 2;
  }

  if (!isShortValue && memory.value.length > 500) {
    score += 1;
  }

  if (memory.key.startsWith("auto-curation/")) {
    score -= 1;
  }

  if (memory.key.startsWith("session-summary/")) {
    score -= 1;
  }

  if (memory.key.includes("gotcha") || memory.key.includes("decision")) {
    score += 2;
  }

  if (memory.key.includes("convention") || memory.key.includes("pattern")) {
    score += 2;
  }
  const retrievals = memory.retrieval_count || 0;

  if (retrievals >= 20) {
    score += 2;
  }

  if (retrievals >= 5 && retrievals < 20) {
    score += 1;
  }

  if (memory.confidence === "stale") {
    score -= 1;
  }

  return Math.max(0, Math.min(10, score));
}
