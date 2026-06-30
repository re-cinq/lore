/**
 * One row in `pipeline.research_attempts`. The autoresearch job records every
 * candidate prompt it generates per query cluster — the approach used, the
 * generated content, its eval score, and the delta over the baseline.
 */
export interface ResearchAttempt {
  clusterId: string;
  namespace: string;
  approach: string;
  content: string;
  evalScore: number;
  delta: number;
}

/**
 * The research-attempts surface. The autoresearch job logs each candidate
 * attempt through here instead of a bespoke DB writer, so the kernel never
 * imports a pg pool directly.
 */
export interface ResearchPort {
  recordAttempt(row: ResearchAttempt): Promise<void>;
}
