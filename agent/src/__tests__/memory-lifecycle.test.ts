import { describe, it, expect } from "vitest";

// ── Importance scoring (copied from memory-lifecycle.ts) ────────────

function scoreImportance(memory: {
  key: string;
  value: string;
  created_at: string;
}): number {
  let score = 5;

  const ageDays = (Date.now() - new Date(memory.created_at).getTime()) / 86400000;
  score -= Math.min(5, Math.floor(ageDays / 30));

  if (memory.value.length < 50) score -= 2;
  else if (memory.value.length > 500) score += 1;

  if (memory.key.startsWith("auto-curation/")) score -= 1;
  if (memory.key.startsWith("session-summary/")) score -= 1;
  if (memory.key.includes("gotcha") || memory.key.includes("decision")) score += 2;
  if (memory.key.includes("convention") || memory.key.includes("pattern")) score += 2;

  return Math.max(0, Math.min(10, score));
}

describe("importance scoring", () => {
  const now = new Date().toISOString();

  it("gives baseline score of 5 for recent, medium-length memory", () => {
    const score = scoreImportance({
      key: "some-memory",
      value: "This is a normal memory with enough content to be useful.",
      created_at: now,
    });
    expect(score).toBe(5);
  });

  it("penalizes old memories", () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const score = scoreImportance({
      key: "old-memory",
      value: "Some old content that is moderately long enough to avoid short penalty.",
      created_at: ninetyDaysAgo,
    });
    expect(score).toBeLessThan(5);
    expect(score).toBe(2); // 5 - 3 (90/30 = 3 months)
  });

  it("penalizes very short content", () => {
    const score = scoreImportance({
      key: "short",
      value: "tiny",
      created_at: now,
    });
    expect(score).toBe(3); // 5 - 2
  });

  it("boosts long, detailed content", () => {
    const score = scoreImportance({
      key: "detailed",
      value: "x".repeat(600),
      created_at: now,
    });
    expect(score).toBe(6); // 5 + 1
  });

  it("penalizes auto-curation entries", () => {
    const score = scoreImportance({
      key: "auto-curation/re-cinq/lore/abc123",
      value: "Some auto-generated lesson from a task outcome that is long enough.",
      created_at: now,
    });
    expect(score).toBe(4); // 5 - 1
  });

  it("penalizes session summaries", () => {
    const score = scoreImportance({
      key: "session-summary/2026-04-06",
      value: "Session ended with 5 tool calls and 0 errors in the lore repo.",
      created_at: now,
    });
    expect(score).toBe(4); // 5 - 1
  });

  it("boosts decision/gotcha memories", () => {
    const score = scoreImportance({
      key: "deployment-gotchas/controller-env",
      value: "The controller deployment is separate from the agent Helm chart. Env vars don't propagate.",
      created_at: now,
    });
    expect(score).toBe(7); // 5 + 2
  });

  it("boosts convention/pattern memories", () => {
    const score = scoreImportance({
      key: "convention/error-handling",
      value: "Always return errors as text in MCP responses, never throw.",
      created_at: now,
    });
    expect(score).toBe(7); // 5 + 2
  });

  it("clamps to 0 minimum", () => {
    const veryOld = new Date(Date.now() - 365 * 86400000).toISOString();
    const score = scoreImportance({
      key: "auto-curation/old",
      value: "x",
      created_at: veryOld,
    });
    expect(score).toBe(0); // can't go below 0
  });

  it("clamps to 10 maximum", () => {
    const score = scoreImportance({
      key: "convention-pattern-decision-gotcha",
      value: "x".repeat(600),
      created_at: now,
    });
    expect(score).toBe(10); // 5 + 1 + 2 + 2 = 10
  });

  it("sorts least important first for eviction", () => {
    const memories = [
      { key: "important-decision", value: "Critical architecture choice explained in detail here and in great depth.", created_at: now },
      { key: "auto-curation/task1", value: "meh", created_at: new Date(Date.now() - 150 * 86400000).toISOString() },
      { key: "session-summary/recent", value: "Session with 10 tool calls and 2 errors in the deployment.", created_at: now },
    ];

    const scored = memories.map((m) => ({ ...m, importance: scoreImportance(m) }));
    scored.sort((a, b) => a.importance - b.importance);

    // auto-curation at 150 days: 5 - 5(age) - 2(short) - 1(auto) = 0 (clamped)
    expect(scored[0].key).toBe("auto-curation/task1"); // lowest
    // session-summary recent: 5 - 0(age) - 0(>50 chars) - 1(session) = 4
    expect(scored[1].key).toBe("session-summary/recent");
    // important-decision recent: 5 - 0(age) - 0(>50) + 2(decision) = 7
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
    const response = "PATTERN: ok\nPATTERN: This is a real pattern with enough content.";
    const patterns = response
      .split("\n")
      .filter((line) => line.startsWith("PATTERN: "))
      .map((line) => line.replace("PATTERN: ", "").trim())
      .filter((p) => p.length > 10);

    expect(patterns).toHaveLength(1);
  });
});
