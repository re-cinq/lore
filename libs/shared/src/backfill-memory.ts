// Backfill exporter (memory-dgraph-migration AC6): migrates Postgres memory.* into Dgraph, preserving each Postgres UUID as the node xid; both passes are idempotent (an existing xid is skipped).
import type { PgPool, DgraphClientPort, DgraphTxn } from "./memory-store.js";

export interface BackfillReport {
  memories: number;
  facts: number;
}

// Opens a fresh Dgraph txn and always discards it afterward; mirrors DgraphMemoryStore's own private withTxn.
async function withTxn<T>(
  dgraph: DgraphClientPort,
  fn: (txn: DgraphTxn) => Promise<T>,
): Promise<T> {
  const txn = dgraph.newTxn();

  try {
    return await fn(txn);
  } finally {
    await txn.discard().catch(() => {});
  }
}

// Postgres's pgvector bracket literal `[v1,v2,...]` is byte-for-byte Dgraph's `float32vector` string shape, so it passes through verbatim — no parse, no re-encode (re-encoding via `toVectorLiteral` would double-wrap it).
function embeddingField(embedding: unknown): Record<string, unknown> {
  return embedding ? { "Memory.embedding": embedding } : {};
}

// The "which xids already live in Dgraph" probe, parameterized by which predicate names the xid — both passes route through here.
async function fetchPresentXids(
  dgraph: DgraphClientPort,
  xidPredicate: string,
): Promise<Set<string>> {
  return withTxn(dgraph, async (probe) => {
    const res = await probe.queryWithVars(
      `query existing { existing(func: has(${xidPredicate})) { ${xidPredicate} } }`,
      {},
    );
    const existing =
      (res.data as { existing?: Record<string, string>[] }).existing ?? [];

    return new Set(existing.map((node) => node[xidPredicate]));
  });
}

// One migration pass: skips rows already in Dgraph, else builds the node via async `buildNode` (so it can resolve FKs first) and creates it. Returns the full row count seen, even on an idempotent re-run.
async function migratePass<Row extends { id: string }>(
  dgraph: DgraphClientPort,
  rows: Row[],
  xidPredicate: string,
  buildNode: (row: Row) => Promise<Record<string, unknown>>,
): Promise<number> {
  const present = await fetchPresentXids(dgraph, xidPredicate);

  for (const row of rows) {
    if (present.has(row.id)) {
      continue;
    }
    const setJson = await buildNode(row);

    await withTxn(dgraph, (txn) => txn.mutate({ setJson, commitNow: true }));
    present.add(row.id);
  }

  return rows.length;
}

async function resolveMemoryUid(
  dgraph: DgraphClientPort,
  memoryXid: string,
): Promise<string | undefined> {
  return withTxn(dgraph, async (probe) => {
    const res = await probe.queryWithVars(
      `query m($x: string) { m(func: eq(Memory.xid, $x)) { uid } }`,
      { $x: memoryXid },
    );

    return (res.data as { m?: { uid: string }[] }).m?.[0]?.uid;
  });
}

export async function backfillMemoryToDgraph(deps: {
  pgPool: PgPool;
  dgraph: DgraphClientPort;
}): Promise<BackfillReport> {
  const { rows: memories } = await deps.pgPool.query<{
    id: string;
    agent_id: string;
    key: string;
    value: string;
    version: number;
    embedding: unknown;
  }>(
    "SELECT id, agent_id, key, value, version, embedding FROM memory.memories",
  );
  const memoryCount = await migratePass(
    deps.dgraph,
    memories,
    "Memory.xid",
    async (row) => ({
      "dgraph.type": "Memory",
      "Memory.xid": row.id,
      "Memory.agent_id": row.agent_id,
      "Memory.key": row.key,
      "Memory.value": row.value,
      "Memory.version": row.version,
      ...embeddingField(row.embedding),
    }),
  );

  const { rows: facts } = await deps.pgPool.query<{
    id: string;
    memory_id: string | null;
    fact_text: string;
    valid_from: string;
  }>("SELECT id, memory_id, fact_text, valid_from FROM memory.facts");
  const factCount = await migratePass(
    deps.dgraph,
    facts,
    "Fact.xid",
    async (fact) => {
      const memoryUid = fact.memory_id
        ? await resolveMemoryUid(deps.dgraph, fact.memory_id)
        : undefined;

      return {
        "dgraph.type": "Fact",
        "Fact.xid": fact.id,
        "Fact.text": fact.fact_text,
        ...(memoryUid ? { "Fact.memory": { uid: memoryUid } } : {}),
      };
    },
  );

  return { memories: memoryCount, facts: factCount };
}
