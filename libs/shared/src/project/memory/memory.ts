import type {
  MemoryPort,
  MemoryRecord,
  MemoryWriteResult,
} from "./memory-port.js";

/**
 * project.memory — repo-bound agent memory over the MemoryPort bridge. The repo
 * scopes every operation so two projects can't read each other's memories.
 */
export class Memory {
  constructor(
    private readonly repo: string,
    private readonly memory: MemoryPort,
  ) {}

  write(
    key: string,
    value: string,
    agentId: string,
  ): Promise<MemoryWriteResult> {
    return this.memory.write(this.repo, key, value, agentId);
  }

  read(key: string, agentId: string): Promise<MemoryRecord | null> {
    return this.memory.read(this.repo, key, agentId);
  }

  list(agentId: string): Promise<MemoryRecord[]> {
    return this.memory.list(this.repo, agentId);
  }
}
