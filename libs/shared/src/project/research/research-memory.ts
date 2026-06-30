import type { ResearchPort, ResearchAttempt } from "./research-port.js";

/**
 * In-memory {@link ResearchPort}: keeps every recorded attempt for test
 * assertions. The double for the autoresearch job so it stays testable
 * without a live `pipeline.research_attempts`.
 */
export class InMemoryResearch implements ResearchPort {
  readonly attempts: ResearchAttempt[] = [];

  async recordAttempt(row: ResearchAttempt): Promise<void> {
    this.attempts.push(row);
  }
}
