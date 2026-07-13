import { describe, it, expect } from "vitest";

// ── Importance scoring (copied from memory-lifecycle.ts) ────────────

function scoreImportance(memory: {
  key: string;
  value: string;
  created_at: string;
  last_retrieved_at?: string | null;
  half_life_days?: number | null;
  retrieval_count?: number | null;
  confidence?: string | null;
}): number {
  const halfLife = memory.half_life_days || 60;
  const effectiveDate = memory.last_retrieved_at || memory.created_at;
  const effectiveAgeDays =
    (Date.now() - new Date(effectiveDate).getTime()) / 86400000;

  // Half-life decay: strength decays from 1.0 to 0.0
  const strength = Math.pow(0.5, effectiveAgeDays / halfLife);

  // Map strength (0-1) to score (0-10)
  let score = Math.round(strength * 10);

  // Content richness
  if (memory.value.length < 50) {
    score -= 2;
  } else if (memory.value.length > 500) {
    score += 1;
  }

  // Key-based importance
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

  // Retrieval frequency boost
  const retrievals = memory.retrieval_count || 0;

  if (retrievals >= 20) {
    score += 2;
  } else if (retrievals >= 5) {
    score += 1;
  }

  // Stale confidence penalty
  if (memory.confidence === "stale") {
    score -= 1;
  }

  return Math.max(0, Math.min(10, score));
}

describe("importance scoring (half-life model)", () => {
  const now = new Date().toISOString();

  it("gives high score for recent memory with default half-life", () => {
    const score = scoreImportance({
      key: "some-memory",
      value: "This is a normal memory with enough content to be useful.",
      created_at: now,
    });

    // strength ≈ 1.0, round(10) = 10, no bonuses/penalties beyond content
    expect(score).toBe(10);
  });

  it("decays with half-life — one half-life old scores ~5", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const score = scoreImportance({
      key: "normal-memory",
      value:
        "Some content that is moderately long enough to avoid short penalty.",
      created_at: sixtyDaysAgo,
    });

    // strength = 0.5^(60/60) = 0.5 → round(5) = 5
    expect(score).toBe(5);
  });

  it("uses last_retrieved_at instead of created_at when available", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const score = scoreImportance({
      key: "retrieved-memory",
      value: "Content that was recently retrieved and is long enough.",
      created_at: sixtyDaysAgo,
      last_retrieved_at: now,
    });

    // Uses now as effective date → strength ≈ 1.0
    expect(score).toBe(10);
  });

  it("respects custom half_life_days", () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const shortHalfLife = scoreImportance({
      key: "short-lived",
      value: "Content that decays fast due to short half-life setting.",
      created_at: thirtyDaysAgo,
      half_life_days: 30,
    });
    const longHalfLife = scoreImportance({
      key: "long-lived",
      value: "Content that decays slow due to long half-life setting.",
      created_at: thirtyDaysAgo,
      half_life_days: 120,
    });

    // short: 0.5^(30/30) = 0.5 → 5
    // long: 0.5^(30/120) ≈ 0.84 → 8
    expect(shortHalfLife).toBe(5);
    expect(longHalfLife).toBe(8);
  });

  it("boosts frequently retrieved memories", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const noRetrievals = scoreImportance({
      key: "normal",
      value: "Normal memory without any retrieval history attached.",
      created_at: sixtyDaysAgo,
    });
    const manyRetrievals = scoreImportance({
      key: "normal",
      value: "Normal memory without any retrieval history attached.",
      created_at: sixtyDaysAgo,
      retrieval_count: 25,
    });

    expect(manyRetrievals).toBe(noRetrievals + 2);
  });

  it("penalizes stale confidence", () => {
    const score = scoreImportance({
      key: "stale-fact",
      value: "A fact that has gone stale over time without being retrieved.",
      created_at: now,
      confidence: "stale",
    });
    const normal = scoreImportance({
      key: "normal-fact",
      value: "A fact that has gone stale over time without being retrieved.",
      created_at: now,
      confidence: "observed",
    });

    expect(score).toBe(normal - 1);
  });

  it("penalizes short content", () => {
    const score = scoreImportance({
      key: "short",
      value: "tiny",
      created_at: now,
    });

    // strength ≈ 1.0 → 10, -2 for short = 8
    expect(score).toBe(8);
  });

  it("boosts decision/gotcha memories", () => {
    const score = scoreImportance({
      key: "deployment-gotchas/controller",
      value:
        "The controller deployment is separate from the agent Helm chart and envs dont propagate.",
      created_at: now,
    });

    // 10 (recent) + 2 (gotcha) = 12, clamped to 10
    expect(score).toBe(10);
  });

  it("clamps to 0 minimum", () => {
    const veryOld = new Date(Date.now() - 365 * 86400000).toISOString();
    const score = scoreImportance({
      key: "auto-curation/old",
      value: "x",
      created_at: veryOld,
      confidence: "stale",
    });

    expect(score).toBe(0);
  });

  it("clamps to 10 maximum", () => {
    const score = scoreImportance({
      key: "convention-pattern-decision-gotcha",
      value: "x".repeat(600),
      created_at: now,
      retrieval_count: 50,
    });

    // 10 + 1(long) + 2(convention) + 2(pattern) + 2(decision) + 2(gotcha) + 2(retrievals) = 21, clamped to 10
    expect(score).toBe(10);
  });

  it("sorts least important first for eviction", () => {
    const memories = [
      {
        key: "important-decision",
        value:
          "Critical architecture choice explained in detail here and great depth.",
        created_at: now,
        retrieval_count: 10,
      },
      {
        key: "auto-curation/task1",
        value: "meh",
        created_at: new Date(Date.now() - 150 * 86400000).toISOString(),
        confidence: "stale" as const,
      },
      {
        key: "session-summary/recent",
        value: "Session with 10 tool calls and 2 errors in the deployment.",
        created_at: now,
      },
    ];

    const scored = memories.map((m) => ({
      ...m,
      importance: scoreImportance(m),
    }));

    scored.sort((a, b) => a.importance - b.importance);

    expect(scored[0].key).toBe("auto-curation/task1"); // lowest
    expect(scored[2].key).toBe("important-decision"); // highest
  });
});

// ── Consolidation pattern parsing ───────────────────────────────────

describe("consolidation pattern parsing", () => {
  it("extracts PATTERN: prefixed lines", () => {
    const response = `Looking at these facts, I see:

PATTERN: The team consistently uses ephemeral K8s Jobs for long-running tasks to survive agent deploys.
PATTERN: Cross-repo ingestion requires HEAD ref, not specific commit SHAs.

These patterns suggest a preference for resilient, stateless execution.`;

    const patterns = response
      .split("\n")
      .filter((line) => line.startsWith("PATTERN: "))
      .map((line) => line.replace("PATTERN: ", "").trim())
      .filter((p) => p.length > 10);

    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toContain("ephemeral K8s Jobs");
    expect(patterns[1]).toContain("HEAD ref");
  });

  it("returns empty for NONE response", () => {
    const response = "NONE";
    const patterns = response
      .split("\n")
      .filter((line) => line.startsWith("PATTERN: "))
      .map((line) => line.replace("PATTERN: ", "").trim())
      .filter((p) => p.length > 10);

    expect(patterns).toHaveLength(0);
  });

  it("filters short patterns", () => {
    const response =
      "PATTERN: ok\nPATTERN: This is a real pattern with enough content.";
    const patterns = response
      .split("\n")
      .filter((line) => line.startsWith("PATTERN: "))
      .map((line) => line.replace("PATTERN: ", "").trim())
      .filter((p) => p.length > 10);

    expect(patterns).toHaveLength(1);
  });
});
