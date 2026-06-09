import { query } from "../platform/db.js";

export interface MemoryUpsert {
  agentId: string;
  key: string;
  value: string;
}

export interface MemoryRepository {
  /** Upserts a version-1 memory row, overwriting the value on key collision. */
  upsert(memory: MemoryUpsert): Promise<void>;
}

export class PgMemoryRepository implements MemoryRepository {
  async upsert(memory: MemoryUpsert): Promise<void> {
    await query(
      `INSERT INTO memory.memories (agent_id, key, value, version)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (agent_id, key, version) DO UPDATE SET value = EXCLUDED.value`,
      [memory.agentId, memory.key, memory.value],
    );
  }
}

/** Composite map key for the in-memory double. */
export function memoryRowKey(agentId: string, key: string): string {
  return `${agentId}::${key}`;
}

/** In-memory test double keyed by `agentId` + `key`, last write wins. */
export class InMemoryMemoryRepository implements MemoryRepository {
  readonly rows = new Map<string, MemoryUpsert>();

  async upsert(memory: MemoryUpsert): Promise<void> {
    this.rows.set(memoryRowKey(memory.agentId, memory.key), memory);
  }
}
