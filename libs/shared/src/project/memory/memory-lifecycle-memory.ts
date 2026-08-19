import type {
  MemoryLifecyclePort,
  AgentCount,
  DecayCandidate,
  RecentFact,
  MemoryUpsert,
  EpisodeInsert,
  AuditLogInsert,
} from "./memory-lifecycle-port.js";

// ── In-memory row shapes (modelling the memory.* tables) ─────────────

/** A `memory.memories` row the double tracks. Defaults match the table. */
export interface MemoryLifecycleRow {
  id: string;
  agent_id: string;
  key: string;
  value: string;
  version: number;
  is_deleted: boolean;
  created_at: string;
  last_retrieved_at: string | null;
  half_life_days: number | null;
  retrieval_count: number | null;
  expires_at: string | null;
}

/** A `memory.facts` row the double tracks. */
export interface FactRow {
  id: string;
  agent_id: string;
  fact_text: string;
  repo: string;
  valid_to: string | null;
  confidence: string;
  created_at: string;
  last_retrieved_at: string | null;
  half_life_days: number | null;
}

/** A `memory.episodes` row the double tracks. */
export interface EpisodeRow {
  id: string;
  agent_id: string;
  content: string;
  content_hash: string;
  source: string;
  ref: string;
}

const DAY_MS = 86_400_000;

function olderThanDays(iso: string | null, days: number): boolean {
  if (!iso) {
    return false;
  }

  return Date.now() - new Date(iso).getTime() > days * DAY_MS;
}

function newerThanDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() < days * DAY_MS;
}

/**
 * In-memory {@link MemoryLifecyclePort}: models memories/facts/episodes/audit
 * rows in arrays so every method is behaviorally assertable — counts,
 * soft-deletes, half_life arithmetic, dedup-on-insert. Seed rows via the
 * constructor; the public arrays are inspected directly in tests.
 */
export class InMemoryMemoryLifecycle implements MemoryLifecyclePort {
  readonly memories: MemoryLifecycleRow[];
  readonly facts: FactRow[];
  readonly episodes: EpisodeRow[];
  readonly auditLog: AuditLogInsert[] = [];
  private seq = 0;

  constructor(
    seed: {
      memories?: MemoryLifecycleRow[];
      facts?: FactRow[];
      episodes?: EpisodeRow[];
    } = {},
  ) {
    this.memories = seed.memories ?? [];
    this.facts = seed.facts ?? [];
    this.episodes = seed.episodes ?? [];
  }

  // memory.memories ──────────────────────────────────────────────────

  async countMemoriesByAgentOverCap(cap: number): Promise<AgentCount[]> {
    const counts = new Map<string, number>();

    for (const m of this.memories) {
      if (m.is_deleted) {
        continue;
      }
      counts.set(m.agent_id, (counts.get(m.agent_id) ?? 0) + 1);
    }

    return [...counts.entries()]
      .filter(([, cnt]) => cnt > cap)
      .map(([agent_id, cnt]) => ({ agent_id, cnt }));
  }

  async findDecayCandidates(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<DecayCandidate[]> {
    return this.memories
      .filter(
        (m) =>
          m.agent_id === agentId &&
          !m.is_deleted &&
          olderThanDays(m.created_at, minAgeDays),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        key: m.key,
        value: m.value,
        created_at: m.created_at,
        last_retrieved_at: m.last_retrieved_at,
        half_life_days: m.half_life_days,
        retrieval_count: m.retrieval_count,
      }));
  }

  async softDeleteMemories(ids: string[]): Promise<void> {
    for (const m of this.memories) {
      if (ids.includes(m.id)) {
        m.is_deleted = true;
      }
    }
  }

  async insertConsolidatedMemory(key: string, value: string): Promise<void> {
    const exists = this.memories.some(
      (m) => m.agent_id === "consolidation" && m.key === key && m.version === 1,
    );

    if (exists) {
      return;
    }
    this.memories.push(this.newMemoryRow("consolidation", key, value, 1));
  }

  async expireMemories(): Promise<number> {
    let count = 0;

    for (const m of this.memories) {
      if (
        m.expires_at !== null &&
        new Date(m.expires_at).getTime() < Date.now() &&
        !m.is_deleted
      ) {
        m.is_deleted = true;
        count++;
      }
    }

    return count;
  }

  async upsertMemory(memory: MemoryUpsert): Promise<void> {
    const existing = this.memories.find(
      (m) =>
        m.agent_id === memory.agentId &&
        m.key === memory.key &&
        m.version === 1,
    );

    if (existing) {
      existing.value = memory.value;

      return;
    }
    this.memories.push(
      this.newMemoryRow(memory.agentId, memory.key, memory.value, 1),
    );
  }

  async appendMemory(
    agentId: string,
    key: string,
    value: string,
  ): Promise<void> {
    const existing = this.memories.find(
      (m) => m.agent_id === agentId && m.key === key,
    );

    if (existing) {
      existing.value = `${existing.value}\n${value}`;
      existing.version += 1;

      return;
    }
    this.memories.push(this.newMemoryRow(agentId, key, value, 1));
  }

  // memory.facts ─────────────────────────────────────────────────────

  async countInvalidatedFactsByAgentOverCap(
    cap: number,
    minAgeDays: number,
  ): Promise<AgentCount[]> {
    const counts = new Map<string, number>();

    for (const f of this.facts) {
      if (!olderThanDays(f.valid_to, minAgeDays)) {
        continue;
      }
      counts.set(f.agent_id, (counts.get(f.agent_id) ?? 0) + 1);
    }

    return [...counts.entries()]
      .filter(([, cnt]) => cnt > cap)
      .map(([agent_id, cnt]) => ({ agent_id, cnt }));
  }

  async deleteOldestInvalidatedFacts(
    agentId: string,
    limit: number,
    minAgeDays: number,
  ): Promise<number> {
    const victims = this.facts
      .filter(
        (f) => f.agent_id === agentId && olderThanDays(f.valid_to, minAgeDays),
      )
      .sort((a, b) => (a.valid_to ?? "").localeCompare(b.valid_to ?? ""))
      .slice(0, limit);

    for (const v of victims) {
      this.facts.splice(this.facts.indexOf(v), 1);
    }

    return victims.length;
  }

  async transitionStaleFacts(): Promise<number> {
    let count = 0;

    for (const f of this.facts) {
      const isDecayableConfidence =
        f.confidence !== "stale" && f.confidence !== "verified";
      const eligible =
        f.valid_to === null &&
        isDecayableConfidence &&
        olderThanDays(f.last_retrieved_at ?? f.created_at, 30);

      if (eligible) {
        f.confidence = "stale";
        count++;
      }
    }

    return count;
  }

  async findRecentValidFacts(
    lookbackDays: number,
    limit: number,
  ): Promise<RecentFact[]> {
    return this.facts
      .filter(
        (f) => f.valid_to === null && newerThanDays(f.created_at, lookbackDays),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((f) => ({ fact_text: f.fact_text, repo: f.repo || "unknown" }));
  }

  // PR-outcome feedback ──────────────────────────────────────────────

  async boostContributors(
    factIds: string[],
    memoryIds: string[],
  ): Promise<void> {
    if (factIds.length > 0) {
      for (const f of this.facts) {
        if (factIds.includes(f.id)) {
          f.half_life_days = Math.min((f.half_life_days ?? 30) + 5, 365);
        }
      }
    }

    if (memoryIds.length > 0) {
      for (const m of this.memories) {
        if (memoryIds.includes(m.id)) {
          m.half_life_days = Math.min((m.half_life_days ?? 60) + 5, 365);
        }
      }
    }
  }

  async penalizeContributors(
    factIds: string[],
    memoryIds: string[],
  ): Promise<void> {
    if (factIds.length > 0) {
      for (const f of this.facts) {
        if (factIds.includes(f.id)) {
          f.half_life_days = Math.max(7, (f.half_life_days ?? 30) - 3);
        }
      }
    }

    if (memoryIds.length > 0) {
      for (const m of this.memories) {
        if (memoryIds.includes(m.id)) {
          m.half_life_days = Math.max(7, (m.half_life_days ?? 60) - 3);
        }
      }
    }
  }

  // memory.audit_log ─────────────────────────────────────────────────

  async writeAuditLog(entry: AuditLogInsert): Promise<void> {
    this.auditLog.push(entry);
  }

  // memory.episodes ──────────────────────────────────────────────────

  async insertEpisode(episode: EpisodeInsert): Promise<string | null> {
    const dup = this.episodes.some(
      (e) =>
        e.agent_id === episode.agentId &&
        e.content_hash === episode.contentHash,
    );

    if (dup) {
      return null;
    }
    const id = `episode-${this.episodes.length + 1}`;

    this.episodes.push({
      id,
      agent_id: episode.agentId,
      content: episode.content,
      content_hash: episode.contentHash,
      source: episode.source,
      ref: episode.ref,
    });

    return id;
  }

  // ── helpers ────────────────────────────────────────────────────────

  private newMemoryRow(
    agentId: string,
    key: string,
    value: string,
    version: number,
  ): MemoryLifecycleRow {
    return {
      id: `mem-${++this.seq}`,
      agent_id: agentId,
      key,
      value,
      version,
      is_deleted: false,
      created_at: new Date().toISOString(),
      last_retrieved_at: null,
      half_life_days: null,
      retrieval_count: null,
      expires_at: null,
    };
  }
}
