/** Org-wide memory.* lifecycle port (decay, cleanup, consolidation, feedback). */

// ── Row + input shapes ──────────────────────────────────────────────

/** One over-cap agent bucket: `{agent_id, cnt}` from a count-by-agent SELECT. */
export interface AgentCount {
  agent_id: string;
  cnt: number;
}

/** Decay candidate row (fields the importance scorer reads). */
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

/** Floor memory-lifecycle SQL surface (Pg + InMemory double). */
export interface MemoryLifecyclePort {
  // memory.memories ──────────────────────────────────────────────────

  /** Count-by-agent in memory.memories over cap. */
  countMemoriesByAgentOverCap(cap: number): Promise<AgentCount[]>;

  /** Old live memories for decay scoring. */
  findDecayCandidates(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<DecayCandidate[]>;

  /** Soft-delete evicted memory ids. */
  softDeleteMemories(ids: string[]): Promise<void>;

  /** Insert one consolidated pattern memory (agent_id='consolidation', v1). */
  insertConsolidatedMemory(key: string, value: string): Promise<void>;

  /** Soft-delete expired memories; return count. */
  expireMemories(): Promise<number>;

  /** Upsert version-1 memory, overwriting on collision. */
  upsertMemory(memory: MemoryUpsert): Promise<void>;

  /** Append to memory on collision, insert otherwise. */
  appendMemory(agentId: string, key: string, value: string): Promise<void>;

  // memory.facts ─────────────────────────────────────────────────────

  /** Count invalidated facts by agent over cap. */
  countInvalidatedFactsByAgentOverCap(
    cap: number,
    minAgeDays: number,
  ): Promise<AgentCount[]>;

  /** Delete oldest invalidated facts per agent (agent scope load-bearing #1376). */
  deleteOldestInvalidatedFacts(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<number>;

  /** Transition unretrieved live facts to stale after 30 days. */
  transitionStaleFacts(): Promise<number>;

  /** Recent live facts with episode repo for consolidation. */
  findRecentValidFacts(
    lookbackDays: number,
    limit: number,
  ): Promise<RecentFact[]>;

  // PR-outcome feedback (merge-check.ts) ─────────────────────────────

  /** On merge, boost half_life of contributing facts/memories. */
  boostContributors(factIds: string[], memoryIds: string[]): Promise<void>;

  /** On rejection, penalize half_life of contributing facts/memories. */
  penalizeContributors(factIds: string[], memoryIds: string[]): Promise<void>;

  // memory.audit_log ─────────────────────────────────────────────────

  /** Append one row to memory.audit_log. */
  writeAuditLog(entry: AuditLogInsert): Promise<void>;

  // memory.episodes ──────────────────────────────────────────────────

  /** Insert episode; return id or null on dedup. */
  insertEpisode(episode: EpisodeInsert): Promise<string | null>;
}
