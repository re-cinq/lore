/**
 * Floor-side memory.* lifecycle port — the SQL surface for the importance-decay,
 * TTL-cleanup, consolidation, PR-outcome-feedback, and review-lesson jobs.
 *
 * This is the org-wide (repo-agnostic) `memory.*` write/read mechanics single-
 * sourced out of Floor, SEPARATE from the agent-facing `memory-port.ts` /
 * `memory.ts` bridge (which scopes by repo over the MemoryStore seam). The
 * tables: `memory.memories`, `memory.facts`, `memory.episodes`,
 * `memory.audit_log`.
 *
 * Every statement is lifted byte-for-byte from the Floor jobs so the integrator
 * can route each method back to its origin (noted per-method).
 */

// ── Row + input shapes ──────────────────────────────────────────────

/** One over-cap agent bucket: `{agent_id, cnt}` from a count-by-agent SELECT. */
export interface AgentCount {
  agent_id: string;
  cnt: number;
}

/**
 * One decay candidate row from `memory.memories` (the fields the importance
 * scorer reads). Mirrors the SELECT in `memory-lifecycle.ts`'s decay loop.
 */
export interface DecayCandidate {
  id: string;
  key: string;
  value: string;
  created_at: string;
  last_retrieved_at: string | null;
  half_life_days: number | null;
  retrieval_count: number | null;
}

/** One recent valid fact for consolidation: `{fact_text, repo}`. */
export interface RecentFact {
  fact_text: string;
  repo: string;
}

/** Input for the version-1 memory upsert (relocated from kernel `memories.ts`). */
export interface MemoryUpsert {
  agentId: string;
  key: string;
  value: string;
}

/** Input for the episode insert (relocated from kernel `episodes.ts`). */
export interface EpisodeInsert {
  agentId: string;
  content: string;
  contentHash: string;
  source: string;
  ref: string;
}

/** One `memory.audit_log` write: agent, operation tag, and free-form metadata. */
export interface AuditLogInsert {
  agentId: string;
  operation: string;
  metadata: Record<string, unknown>;
}

// ── Port ────────────────────────────────────────────────────────────

/**
 * The Floor memory-lifecycle SQL surface. Implemented by the Pg adapter (live)
 * and the InMemory double (the behavioral spec).
 */
export interface MemoryLifecyclePort {
  // memory.memories ──────────────────────────────────────────────────

  /** memory-lifecycle.ts importanceDecayJob — count-by-agent over
   * `memory.memories` (is_deleted=false), agents holding more than `cap`. */
  countMemoriesByAgentOverCap(cap: number): Promise<AgentCount[]>;

  /** memory-lifecycle.ts importanceDecayJob — old (> `minAgeDays`) live
   * memories for one agent, oldest-first, capped at `limit`, scored upstream. */
  findDecayCandidates(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<DecayCandidate[]>;

  /** memory-lifecycle.ts importanceDecayJob — soft-delete (is_deleted=TRUE)
   * the evicted memory ids. */
  softDeleteMemories(ids: string[]): Promise<void>;

  /** memory-lifecycle.ts consolidationJob — insert one consolidated pattern as
   * an agent_id='consolidation', version-1 memory (ON CONFLICT (agent_id, key,
   * version) DO NOTHING). */
  insertConsolidatedMemory(key: string, value: string): Promise<void>;

  /** ttl-cleanup.ts ttlCleanupJob — soft-delete every memory whose `expires_at`
   * has passed; returns the count expired. */
  expireMemories(): Promise<number>;

  /** kernel/repositories/memories.ts upsert — version-1 memory, overwriting the
   * value on (agent_id, key, version) collision. */
  upsertMemory(memory: MemoryUpsert): Promise<void>;

  /** review-reactor.ts — append `value` (newline-joined) to the existing memory
   * on (agent_id, key) collision, bumping version; insert otherwise. */
  appendMemory(agentId: string, key: string, value: string): Promise<void>;

  // memory.facts ─────────────────────────────────────────────────────

  /** memory-lifecycle.ts importanceDecayJob — count invalidated (valid_to past
   * `minAgeDays`) facts by agent, agents over `cap`. */
  countInvalidatedFactsByAgentOverCap(
    cap: number,
    minAgeDays: number,
  ): Promise<AgentCount[]>;

  /** DELETE the `limit` oldest invalidated facts BELONGING TO `agentId` (CTE on
   * valid_to); returns how many were deleted. The agent scope is load-bearing:
   * the decay job calls this once per over-cap agent, so a global delete ran N
   * table-wide deletes and could take one agent's quota out of another's facts,
   * including agents under the cap (#1376). */
  deleteOldestInvalidatedFacts(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<number>;

  /** memory-lifecycle.ts importanceDecayJob — transition unretrieved live facts
   * to confidence='stale' after 30 days; returns how many transitioned. */
  transitionStaleFacts(): Promise<number>;

  /** memory-lifecycle.ts consolidationJob — recent (< `lookbackDays`) live facts
   * with their episode repo, newest-first, capped at `limit`. */
  findRecentValidFacts(
    lookbackDays: number,
    limit: number,
  ): Promise<RecentFact[]>;

  // PR-outcome feedback (merge-check.ts) ─────────────────────────────

  /** merge-check.ts — on merge, +5 half_life (cap 365) to contributing facts
   * and +5 (cap 365) to contributing memories. No-ops on empty id lists. */
  boostContributors(factIds: string[], memoryIds: string[]): Promise<void>;

  /** merge-check.ts — on rejection, -3 half_life (floor 7) to contributing facts
   * and -3 (floor 7) to contributing memories. No-ops on empty id lists. */
  penalizeContributors(factIds: string[], memoryIds: string[]): Promise<void>;

  // memory.audit_log ─────────────────────────────────────────────────

  /** memory-lifecycle.ts + merge-check.ts — append one row to
   * `memory.audit_log` (agent_id, operation, metadata). */
  writeAuditLog(entry: AuditLogInsert): Promise<void>;

  // memory.episodes ──────────────────────────────────────────────────

  /** kernel/repositories/episodes.ts insert — insert an episode; returns its id,
   * or null when the (agent_id, content_hash) pair already exists (dedup). */
  insertEpisode(episode: EpisodeInsert): Promise<string | null>;
}
