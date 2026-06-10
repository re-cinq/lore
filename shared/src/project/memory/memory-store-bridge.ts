import type { MemoryStore } from "../../memory-store.js";
import type { MemoryPort, MemoryRecord, MemoryWriteResult } from "./memory-port.js";

/**
 * Bridges the existing MemoryStore seam onto the repo-scoped MemoryPort. No new
 * backend — the Project builds the store via selectMemoryStore(pg, dgraph) and
 * hands it here.
 */
export class MemoryStoreBridge implements MemoryPort {
  constructor(private readonly store: MemoryStore) {}

  async write(repo: string, key: string, value: string, agentId: string): Promise<MemoryWriteResult> {
    const res = await this.store.writeMemory({ key, value, agentId, repo });
    return { key: res.key, version: res.version };
  }

  async read(repo: string, key: string, agentId: string): Promise<MemoryRecord | null> {
    const found = await this.store.readMemory(key, agentId);
    if (!found) return null;
    return { key, value: found.value, version: found.version };
  }

  async list(repo: string, agentId: string): Promise<MemoryRecord[]> {
    const { memories } = await this.store.listMemories({ agentId, repo });
    return memories.map((m) => ({ key: m.key, value: m.value, version: m.version }));
  }
}
