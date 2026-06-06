/**
 * Memory store abstraction.
 *
 * The seam Lore's memory layer talks to. Grows method-by-method as
 * later cycles triangulate the surface. Postgres is the only backend
 * today; Dgraph arrives via the migration without touching callers.
 */

// ── Ports ────────────────────────────────────────────────────────────

/**
 * The pg pool port the Postgres backend depends on. Owned by the seam
 * module so the contract lives with the interface, not the implementation.
 */
export type PgPool = { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> };

// ── Result types ─────────────────────────────────────────────────────

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

// ── Interface ────────────────────────────────────────────────────────

export interface MemoryStore {
  readonly backend: "postgres" | "dgraph";

  writeMemory(input: {
    key: string;
    value: string;
    agentId: string;
    ttl?: number;
    embedding?: number[];
    repo?: string;
  }): Promise<WriteResult>;

  readMemory(key: string, agentId: string, version?: string | number): Promise<any>;

  deleteMemory(key: string, agentId: string): Promise<{ key: string; deleted: boolean }>;

  listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: any[]; total: number }>;
}

// ── Selection ────────────────────────────────────────────────────────

import { PostgresMemoryStore } from "./postgres-memory-store.js";

export function selectMemoryStore(clients: { pgPool?: unknown; dgraph?: unknown }): MemoryStore {
  const backend = process.env.LORE_MEMORY_BACKEND ?? "postgres";
  if (backend === "dgraph") {
    if (!clients.dgraph) throw new Error("LORE_MEMORY_BACKEND=dgraph but no dgraph client provided");
    throw new Error("DgraphMemoryStore not yet implemented (Phase 2)");
  }
  if (!clients.pgPool) throw new Error("LORE_MEMORY_BACKEND=postgres but no pgPool client provided");
  return new PostgresMemoryStore(clients.pgPool as PgPool);
}

// ── Singleton ────────────────────────────────────────────────────────

let registeredStore: MemoryStore | null = null;

export function setMemoryStore(store: MemoryStore): void {
  registeredStore = store;
}

export function memoryStore(): MemoryStore {
  if (!registeredStore) throw new Error("No memory store configured — call setMemoryStore() at startup");
  return registeredStore;
}
