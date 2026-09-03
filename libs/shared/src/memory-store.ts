import { enforceTrue } from "./lib/enforce.js";
/** Memory store abstraction, the seam Lore's memory layer talks to; both Postgres and Dgraph backends are wired, selected via LORE_MEMORY_BACKEND without touching callers. */

// ── Ports ────────────────────────────────────────────────────────────

/** The pg pool port the Postgres backend depends on; owned by the seam module so the contract lives with the interface, not the implementation. */
export type PgPool = {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

/** A checked-out client for a multi-statement transaction. */
export type MemoryTxClient = {
  query: PgPool["query"];
  release: () => void;
};

/** connect() is feature-detected, not declared on PgPool: pg's PoolClient has an incompatible inherited connect() that would break every client-as-pool call site if widened. */
export function hasConnect(
  p: PgPool,
): p is PgPool & { connect(): Promise<MemoryTxClient> } {
  return typeof (p as { connect?: unknown }).connect === "function";
}

/** The Dgraph client port the Dgraph backend depends on; the real dgraph-js-http DgraphClient satisfies it structurally. */
export interface DgraphTxn {
  queryWithVars(
    query: string,
    vars: Record<string, string>,
  ): Promise<{ data: Record<string, Record<string, unknown>[]> }>;
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

/** A stored memory row (or version row). Columns vary by query, so keep it open. */
export type MemoryRecord = Record<string, unknown>;

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
  ): Promise<MemoryRecord | MemoryRecord[] | null>;

  deleteMemory(
    key: string,
    agentId: string,
  ): Promise<{ key: string; deleted: boolean }>;

  listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: MemoryRecord[]; total: number }>;
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
      Error,
      "LORE_MEMORY_BACKEND=dgraph but no dgraph client provided",
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
    Error,
    "LORE_MEMORY_BACKEND=postgres but no pgPool client provided",
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
    Error,
    "No memory store configured — call setMemoryStore() at startup",
  );

  return registeredStore;
}
