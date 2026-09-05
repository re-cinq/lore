import { enforceTrue } from "./lib/enforce.js";
/** Memory store abstraction, the seam Lore's memory layer talks to; both Postgres and Dgraph backends are wired, selected via LORE_MEMORY_BACKEND without touching callers. */

// Ports + shapes (PgPool/MemoryTxClient/hasConnect/DgraphTxn/DgraphClientPort/WriteResult/MemoryRecord/MemoryStore) live in memory-store-types.ts, re-exported for import-path back-compat.
export {
  type PgPool,
  type MemoryTxClient,
  hasConnect,
  type DgraphTxn,
  type DgraphClientPort,
  type WriteResult,
  type MemoryRecord,
  type MemoryStore,
} from "./memory-store-types.js";
import type {
  DgraphClientPort,
  PgPool,
  MemoryStore,
} from "./memory-store-types.js";

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
