/** What the embedder has been answering lately. The 403 outage of 2026-08-13 → 09-09 was visible only as a log line nobody grepped; this is the same fact as a value /healthz, the assembled bundle and lore-doctor can read. */
export interface EmbeddingHealth {
  lastOkAt: string | null;
  lastFailureAt: string | null;
  /** HTTP status of the last refused call; null when no call could be made (no credential, no project, network). */
  lastStatus: number | null;
  consecutiveFailures: number;
}

export type EmbeddingOutcome =
  { ok: true } | { ok: false; status: number | null };

/** Three in a row separates an outage from one transient refusal. */
export const EMBEDDER_DEGRADED_AFTER = 3;

const HEALTHY: EmbeddingHealth = {
  lastOkAt: null,
  lastFailureAt: null,
  lastStatus: null,
  consecutiveFailures: 0,
};

let health: EmbeddingHealth = { ...HEALTHY };

export function embedderDegraded(
  current: EmbeddingHealth = embeddingHealth(),
): boolean {
  return current.consecutiveFailures >= EMBEDDER_DEGRADED_AFTER;
}

export function embeddingHealth(): EmbeddingHealth {
  return { ...health };
}

export function resetEmbeddingHealth(): void {
  health = { ...HEALTHY };
}

export function recordEmbeddingOutcome(outcome: EmbeddingOutcome): void {
  const at = new Date().toISOString();

  health = outcome.ok
    ? { ...health, lastOkAt: at, consecutiveFailures: 0 }
    : {
        ...health,
        lastFailureAt: at,
        lastStatus: outcome.status,
        consecutiveFailures: health.consecutiveFailures + 1,
      };
}
