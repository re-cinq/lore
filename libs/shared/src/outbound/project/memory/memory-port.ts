/** Agent-memory port: repo-bound facade over MemoryStore seam. */

export interface MemoryWriteResult {
  key: string;
  version: number;
}

/** Projection of memory.memories: three columns only. */
export interface MemoryRecord {
  key: string;
  value: string;
  version: number;
}

export interface MemoryPort {
  write(
    repo: string,
    key: string,
    value: string,
    agentId: string,
  ): Promise<MemoryWriteResult>;
  read(
    repo: string,
    key: string,
    agentId: string,
  ): Promise<MemoryRecord | null>;
  list(repo: string, agentId: string): Promise<MemoryRecord[]>;
}
