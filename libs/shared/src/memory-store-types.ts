/** The MemoryStore seam's ports and shapes, split out so postgres-memory-store.ts and memory-store.ts (which wires backends together) can both depend on them without importing each other. */

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

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

/** A stored memory row (or version row). Columns vary by query, so keep it open. */
export type MemoryRecord = Record<string, unknown>;

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
