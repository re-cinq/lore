import type { MemoryStore } from "../../memory-store.js";
import type {
  MemoryPort,
  MemoryRecord,
  MemoryWriteResult,
} from "./memory-port.js";

/**
 * Bridges the existing MemoryStore seam onto the repo-scoped MemoryPort. No new
 * backend — the Project builds the store via selectMemoryStore(pg, dgraph) and
 * hands it here.
 */
export class MemoryStoreBridge implements MemoryPort {
  constructor(private readonly store: MemoryStore) {}

  async write(
    repo: string,
    key: string,
    value: string,
    agentId: string,
  ): Promise<MemoryWriteResult> {
    const res = await this.store.writeMemory({ key, value, agentId, repo });

    return { key: res.key, version: res.version };
  }

  async read(
    repo: string,
    key: string,
    agentId: string,
  ): Promise<MemoryRecord | null> {
    const found = await this.store.readMemory(key, agentId);

    if (!found || Array.isArray(found)) {
      return null;
    }

    return {
      key,
      value: String(found.value ?? ""),
      version: Number(found.version ?? 0),
    };
  }

  async list(repo: string, agentId: string): Promise<MemoryRecord[]> {
    const { memories } = await this.store.listMemories({ agentId, repo });

    return memories.map((m) => ({
      key: String(m.key ?? ""),
      value: String(m.value ?? ""),
      version: Number(m.version ?? 0),
    }));
  }
}
