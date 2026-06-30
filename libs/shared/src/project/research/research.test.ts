import { describe, it, expect } from "vitest";
import { PgResearch } from "./research-pg.js";
import { InMemoryResearch } from "./research-memory.js";
import type { ResearchAttempt } from "./research-port.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(): { pool: PgPool; calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: [] };
    },
  };
  return { pool, calls };
}

const directAttempt: ResearchAttempt = {
  clusterId: "deploy-gotchas",
  namespace: "octo/repo",
  approach: "direct",
  content: "Use --set-string for SHA tags.",
  evalScore: 0.82,
  delta: 0.07,
};

describe("PgResearch adapter", () => {
  it("inserts into pipeline.research_attempts in cluster_id, namespace, approach, content, eval_score, delta order", async () => {
    const { pool, calls } = fakePool();

    await new PgResearch(pool).recordAttempt(directAttempt);

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.research_attempts");
    expect(calls[0]?.params).toEqual([
      "deploy-gotchas",
      "octo/repo",
      "direct",
      "Use --set-string for SHA tags.",
      0.82,
      0.07,
    ]);
  });
});

describe("InMemoryResearch double", () => {
  it("keeps every recorded attempt for assertions", async () => {
    const research = new InMemoryResearch();

    await research.recordAttempt(directAttempt);
    await research.recordAttempt({ ...directAttempt, approach: "constraint", delta: -0.02 });

    expect(research.attempts).toEqual([
      directAttempt,
      { ...directAttempt, approach: "constraint", delta: -0.02 },
    ]);
  });
});
