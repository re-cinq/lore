/**
 * Shadow decorator over the MemoryStore seam.
 *
 * Serves every operation from the `primary` store. On reads it also
 * queries the `shadow` store out-of-band, comparing the two results and
 * emitting a divergence metric when they differ — a shadow failure can
 * never break the served read. Used to validate a new backend against
 * the live one before cutover.
 */

import type {
  MemoryRecord,
  MemoryStore,
  WriteResult,
} from "./memory-store.js";

// ── Contract ─────────────────────────────────────────────────────────

/** Metric raised when the primary and shadow reads disagree (AC8). */
const DIVERGENCE_METRIC = "lore.memory.shadow_divergence";

/** Two read results diverge when they are not structurally equal. */
function diverges(primaryResult: unknown, shadowResult: unknown): boolean {
  return JSON.stringify(primaryResult) !== JSON.stringify(shadowResult);
}

// ── Ports ────────────────────────────────────────────────────────────

export interface ShadowMetrics {
  increment(name: string, attrs?: Record<string, unknown>): void;
}

export interface ShadowDeps {
  metrics?: ShadowMetrics;
  logger?: { error(...args: unknown[]): void };
}

// ── Decorator ────────────────────────────────────────────────────────

export class ShadowMemoryStore implements MemoryStore {
  constructor(
    private readonly primary: MemoryStore,
    private readonly shadow: MemoryStore,
    private readonly deps: ShadowDeps = {},
  ) {}

  get backend(): "postgres" | "dgraph" {
    return this.primary.backend;
  }

  writeMemory(input: {
    key: string;
    value: string;
    agentId: string;
    ttl?: number;
    embedding?: number[];
    repo?: string;
  }): Promise<WriteResult> {
    return this.primary.writeMemory(input);
  }

  async readMemory(
    key: string,
    agentId: string,
    version?: string | number,
  ): Promise<MemoryRecord | MemoryRecord[] | null> {
    const primaryResult = await this.primary.readMemory(key, agentId, version);

    try {
      const shadowResult = await this.shadow.readMemory(key, agentId, version);

      if (diverges(primaryResult, shadowResult)) {
        this.deps.metrics?.increment(DIVERGENCE_METRIC);
      }
    } catch (err) {
      this.deps.logger?.error("shadow read failed", err);
    }

    return primaryResult;
  }

  deleteMemory(
    key: string,
    agentId: string,
  ): Promise<{ key: string; deleted: boolean }> {
    return this.primary.deleteMemory(key, agentId);
  }

  listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: MemoryRecord[]; total: number }> {
    return this.primary.listMemories(opts);
  }
}
