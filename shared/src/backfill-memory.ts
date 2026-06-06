/**
 * Backfill exporter (memory-dgraph-migration AC6) — migrates Postgres
 * memory.* into Dgraph, preserving each Postgres UUID as the node xid.
 *
 * Current scope: two passes — memory.memories → Memory nodes (with the
 * pgvector embedding carried verbatim, see embeddingField) and memory.facts
 * → Fact nodes, each Fact.memory wired to its Memory by resolving the
 * fact's memory_id FK to the Memory uid. Both passes are idempotent: an
 * xid already present in Dgraph is skipped, so re-running adds only the
 * missing rows. Fact embeddings and other tables are later facets.
 */

import type { PgPool, DgraphClientPort, DgraphTxn } from "./memory-store.js";

export interface BackfillReport {
  memories: number;
  facts: number;
}

/**
 * Run `fn` inside a fresh Dgraph txn and always discard it afterward. The
 * "open a txn, do work, best-effort discard in finally" dance is one piece of
 * knowledge — the present-set probe and the per-row create both route through
 * here instead of re-deriving the try/finally. Mirrors DgraphMemoryStore's own
 * private withTxn (see future_improvements for the cross-module dedup).
 */
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

/**
 * Postgres stores the embedding as a pgvector value that serializes to the
 * bracket literal `[v1,v2,...]` — byte-for-byte the STRING shape Dgraph's
 * `float32vector` predicate demands. The two formats are identical, so the
 * literal passes through verbatim: NO parse, NO re-encode (re-encoding via the
 * store's `toVectorLiteral` would double-wrap it). This load-bearing
 * equivalence lives in one named place rather than as an anonymous spread.
 */
function embeddingField(embedding: unknown): Record<string, unknown> {
  return embedding ? { "Memory.embedding": embedding } : {};
}

/**
 * The "which xids already live in Dgraph" probe is one piece of knowledge,
 * parameterized only by which predicate names the xid (Memory.xid / Fact.xid).
 * Both passes route through here so the func(has(...)) → Set dance exists once.
 */
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

/**
 * One migration pass: skip rows whose xid is already in Dgraph, otherwise build
 * the node's setJson via `buildNode` and create it. `buildNode` is async so a
 * pass can resolve FKs (the facts pass resolves memory_id → Memory uid) before
 * shaping its node. Returns the number of rows seen (idempotent re-runs still
 * report the full table count, matching BackfillReport semantics).
 */
async function migratePass<Row extends { id: string }>(
  dgraph: DgraphClientPort,
  rows: Row[],
  xidPredicate: string,
  buildNode: (row: Row) => Promise<Record<string, unknown>>,
): Promise<number> {
  const present = await fetchPresentXids(dgraph, xidPredicate);
  for (const row of rows) {
    if (present.has(row.id)) continue;
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
  const { rows: memories } = await deps.pgPool.query(
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

  const { rows: facts } = await deps.pgPool.query(
    "SELECT id, memory_id, fact_text, valid_from FROM memory.facts",
  );
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
