import { enforceTrue } from "./lib/enforce.js";
/**
 * Memory store abstraction.
 *
 * The seam Lore's memory layer talks to. Grows method-by-method as
 * later cycles triangulate the surface. Both Postgres and Dgraph backends
 * are wired; `LORE_MEMORY_BACKEND` selects one without touching callers.
 */

// ── Ports ────────────────────────────────────────────────────────────

/**
 * The pg pool port the Postgres backend depends on. Owned by the seam
 * module so the contract lives with the interface, not the implementation.
 */
export type PgPool = {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
};

/**
 * The Dgraph client port the Dgraph backend depends on. Owned by the seam
 * module so the contract lives with the interface, not the implementation —
 * the real `dgraph-js-http` DgraphClient satisfies it structurally.
 */
export interface DgraphTxn {
  queryWithVars(
    query: string,
    vars: Record<string, string>,
  ): Promise<{ data: any }>;
  mutate(req: {
    setJson?: unknown;
    setNquads?: string;
    deleteNquads?: string;
    commitNow?: boolean;
  }): Promise<unknown>;
  discard(): Promise<unknown>;
}

export type DgraphClientPort = { newTxn(): DgraphTxn };

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

  readMemory(
    key: string,
    agentId: string,
    version?: string | number,
  ): Promise<any>;

  deleteMemory(
    key: string,
    agentId: string,
  ): Promise<{ key: string; deleted: boolean }>;

  listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: any[]; total: number }>;
}

// ── Selection ────────────────────────────────────────────────────────

import { PostgresMemoryStore } from "./postgres-memory-store.js";
import { DgraphMemoryStore } from "./dgraph-memory-store.js";

export function selectMemoryStore(clients: {
  pgPool?: unknown;
  dgraph?: unknown;
}): MemoryStore {
  const backend = process.env.LORE_MEMORY_BACKEND ?? "postgres";
  if (backend === "dgraph") {
    enforceTrue(
      clients.dgraph,
      new Error("LORE_MEMORY_BACKEND=dgraph but no dgraph client provided"),
    );
    return new DgraphMemoryStore(clients.dgraph as DgraphClientPort);
  }
  if (backend !== "postgres") {
    throw new Error(
      `Unknown LORE_MEMORY_BACKEND="${backend}" (valid: postgres, dgraph)`,
    );
  }
  enforceTrue(
    clients.pgPool,
    new Error("LORE_MEMORY_BACKEND=postgres but no pgPool client provided"),
  );
  return new PostgresMemoryStore(clients.pgPool as PgPool);
}

// ── Singleton ────────────────────────────────────────────────────────

let registeredStore: MemoryStore | null = null;

export function setMemoryStore(store: MemoryStore): void {
  registeredStore = store;
}

export function memoryStore(): MemoryStore {
  enforceTrue(
    registeredStore,
    new Error("No memory store configured — call setMemoryStore() at startup"),
  );
  return registeredStore;
}
