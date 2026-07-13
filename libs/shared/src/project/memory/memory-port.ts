/**
 * Agent-memory port. A thin bridge over the existing MemoryStore seam
 * (shared/src/memory-store.ts) — no new backend, just the repo-bound facade
 * surface. Grows toward search/episodes as those land behind the seam.
 */

export interface MemoryWriteResult {
  key: string;
  version: number;
}

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
