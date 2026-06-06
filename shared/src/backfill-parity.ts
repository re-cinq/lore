export interface ParitySummary {
  tables: Record<string, { pg: number; dgraph: number }>;
  meanTopkJaccard: number;
}

export interface GateResult {
  passed: boolean;
  exitCode: number;
  failures: string[];
}

export function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 1; // both empty → 1: two empty result sets are vacuously identical (opposite of meanTopkJaccard's fail-safe 0)
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  return intersection / union.size;
}

export function meanTopkJaccard(scores: number[]): number {
  if (scores.length === 0) return 0; // empty sample → 0 so the retrieval gate fails loudly, never vacuously passes (opposite of jaccard's vacuous-identity 1)
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

export function evaluateParityGates(summary: ParitySummary, threshold = 0.8): GateResult {
  const failures: string[] = [];
  for (const [table, { pg, dgraph }] of Object.entries(summary.tables)) {
    if (pg !== dgraph) {
      failures.push(`row-count mismatch for ${table}: pg=${pg} dgraph=${dgraph}`);
    }
  }
  if (summary.meanTopkJaccard < threshold) {
    failures.push(`retrieval top-K Jaccard ${summary.meanTopkJaccard} below threshold ${threshold}`);
  }
  const passed = failures.length === 0;
  return { passed, exitCode: passed ? 0 : 1, failures };
}
