import type { PgPool } from "@re-cinq/lore-shared";
// PostgreSQL-backed memory CRUD: write/read/delete/list against memory.memories, memory.memory_versions, and memory.audit_log, using the same pool-injection pattern as db.ts.

import { resolveAgentId } from "@re-cinq/lore-shared";
import {
  getMemoryPool,
  firstRow,
  toEmbeddingParam,
  runInTransaction,
  auditLog,
  type WriteResult,
  type MemoryWriteInput,
} from "./memory-core.js";

// Pool management + shared write/tx primitives live in memory-core.ts, re-exported for import-path back-compat.
export {
  getMemoryPool,
  setMemoryPool,
  isMemoryDbAvailable,
  toEmbeddingParam,
  runInTransaction,
  auditLog,
  type WriteResult,
  type MemoryWriteInput,
} from "./memory-core.js";

// ── Write ────────────────────────────────────────────────────────────

interface MemoryLookup {
  field: string;
  value: string;
}

// Look up a memory row by repo (preferred) or agent, when neither is set.
function resolveLookup(repo: string | undefined, agent: string): MemoryLookup {
  if (repo) {
    return { field: "repo", value: repo };
  }

  return { field: "agent_id", value: agent };
}

interface UpsertArgs {
  key: string;
  value: string;
  agent: string;
  ttl?: number;
  embedding?: number[];
  repo?: string;
}

type Upsert = { memoryId: string; version: number };

// `ttl_seconds` is bound twice on purpose: the stored value and the interval that derives `expires_at` from it must come from the same number, or a row would advertise a TTL it does not honour.
const SUPERSEDE_SQL = `UPDATE memory.memories
   SET value = $1, version = $2, embedding = $3,
       ttl_seconds = $4, expires_at = now() + make_interval(secs => $5),
       created_at = now()
   WHERE id = $6`;

interface RowWrite {
  value: string;
  embeddingParam: string | null;
  ttlSeconds: number | null;
}

// Overwrites the live row in place. `created_at` is refreshed because decay scores age from the LAST write, not the first — a memory rewritten today is not stale just because it was created a year ago.
async function supersedeRow(
  db: Pick<PgPool, "query">,
  memoryId: string,
  version: number,
  write: RowWrite,
): Promise<void> {
  await db.query(SUPERSEDE_SQL, [
    write.value,
    version,
    write.embeddingParam,
    write.ttlSeconds,
    write.ttlSeconds,
    memoryId,
  ]);
}

/** Supersedes the live row IN PLACE, keeping its id — the version table is what preserves the old value, and a new id here would orphan every fact and episode already pointing at this memory. `created_at` is refreshed because decay scores age from the last write, not the first. */
async function updateExisting(
  db: Pick<PgPool, "query">,
  row: { id: string; version: number },
  write: {
    value: string;
    embeddingParam: string | null;
    ttlSeconds: number | null;
  },
): Promise<Upsert> {
  const { value, embeddingParam } = write;
  const memoryId = row.id;
  const version = row.version + 1;

  await supersedeRow(db, memoryId, version, write);
  await insertVersionRecord(db, { memoryId, version, value, embeddingParam });

  return { memoryId, version };
}

/** The first write of a key: the row and its version 1 entry, so a memory is never in the store without the history that explains it. */
async function insertFirst(
  db: Pick<PgPool, "query">,
  args: UpsertArgs,
  write: { embeddingParam: string | null; ttlSeconds: number | null },
): Promise<Upsert> {
  const { key, value, agent, repo } = args;
  const { embeddingParam, ttlSeconds } = write;
  const version = 1;
  const result = await db.query(
    `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at, repo)
     VALUES ($1, $2, $3, $4, 1, $5, now() + make_interval(secs => $6), $7)
     RETURNING id, created_at`,
    [agent, key, value, embeddingParam, ttlSeconds, ttlSeconds, repo || null],
  );
  const memoryId = firstRow(result).id as string;

  await insertVersionRecord(db, { memoryId, version, value, embeddingParam });

  return { memoryId, version };
}

async function upsertMemoryWithVersion(
  db: Pick<PgPool, "query">,
  args: UpsertArgs,
): Promise<Upsert> {
  const { key, agent, ttl, embedding, repo } = args;
  const write = {
    embeddingParam: toEmbeddingParam(embedding),
    ttlSeconds: ttl || null,
  };
  const existing = await findLiveRow(db, { key, agent, repo });

  return existing
    ? updateExisting(db, existing, { ...write, value: args.value })
    : insertFirst(db, args, write);
}

// The live row for this key, if there is one. A repo-scoped memory is looked up BY REPO and an agent's own by agent — the same key means different memories in each, so getting this wrong would have one overwrite the other.
async function findLiveRow(
  db: Pick<PgPool, "query">,
  scope: { key: string; agent: string; repo?: string },
): Promise<{ id: string; version: number } | null> {
  const lookup = resolveLookup(scope.repo, scope.agent);
  const existing = await db.query(
    `SELECT id, version FROM memory.memories
     WHERE ${lookup.field} = $1 AND key = $2 AND is_deleted = FALSE
     ORDER BY version DESC LIMIT 1`,
    [lookup.value, scope.key],
  );

  if (existing.rows.length === 0) {
    return null;
  }
  const row = firstRow(existing);

  return { id: row.id as string, version: row.version as number };
}

// A memories row is never written without its version record (#1154).
interface VersionRecord {
  memoryId: string;
  version: number;
  value: string;
  embeddingParam: string | null;
}

async function insertVersionRecord(
  db: Pick<PgPool, "query">,
  { memoryId, version, value, embeddingParam }: VersionRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO memory.memory_versions (memory_id, version, value, embedding)
     VALUES ($1, $2, $3, $4)`,
    [memoryId, version, value, embeddingParam],
  );
}

// The timestamp the row ended up with. Read back rather than taken from the caller's clock: the write sets `created_at` to the DATABASE's `now()`, and reporting a different instant would put the two out of step.
async function readCreatedAt(memoryId: string): Promise<string> {
  const row = await getMemoryPool()!.query(
    `SELECT created_at FROM memory.memories WHERE id = $1`,
    [memoryId],
  );

  return firstRow(row).created_at as string;
}

export async function writeMemory(
  input: MemoryWriteInput,
): Promise<WriteResult> {
  const agent = resolveAgentId(input.agentId);
  const db = getMemoryPool()!;
  const { memoryId, version } = await runInTransaction(db, (tx) =>
    upsertMemoryWithVersion(tx, { ...input, agent }),
  );

  await auditLog(agent, "write", input.key);

  return {
    key: input.key,
    version,
    agent_id: agent,
    created_at: await readCreatedAt(memoryId),
  };
}

function listScope(
  repo: string | undefined,
  agentId: string | undefined,
  limit: number,
  offset: number,
): { filter: string; params: unknown[] } {
  if (repo) {
    return { filter: "repo = $1 AND", params: [repo, limit, offset] };
  }

  if (agentId) {
    return {
      filter: "agent_id = $1 AND",
      params: [resolveAgentId(agentId), limit, offset],
    };
  }

  return { filter: "", params: [limit, offset] };
}

function countScopeParams(
  repo: string | undefined,
  agentId: string | undefined,
): string[] {
  if (repo) {
    return [repo];
  }

  if (agentId) {
    return [resolveAgentId(agentId)];
  }

  return [];
}

// One page of live memories, newest first. `has_facts` is an EXISTS rather than a join — the caller only needs to know whether extraction found anything, and joining would multiply the row per fact.
async function listPage(filter: string, params: unknown[]) {
  const { rows } = await getMemoryPool()!.query(
    `SELECT key, agent_id, repo, version, created_at, ttl_seconds,
            EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
     FROM memory.memories m
     WHERE ${filter} is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows;
}

// How many there are in total, under the SAME filter as the page — a count taken under different terms would make the pager promise pages that are not there.
async function countScoped(
  filter: string,
  countParams: unknown[],
): Promise<number> {
  const countResult = await getMemoryPool()!.query(
    `SELECT count(*)::int as total FROM memory.memories
     WHERE ${filter} is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())`,
    countParams,
  );

  return firstRow(countResult).total as number;
}

export async function listMemories(
  agentId?: string,
  limit: number = 50,
  offset: number = 0,
  repo?: string,
): Promise<{ memories: Record<string, unknown>[]; total: number }> {
  // Scope by repo (preferred) or agent_id
  const { filter, params } = listScope(repo, agentId, limit, offset);

  const rows = await listPage(filter, params);
  const total = await countScoped(filter, countScopeParams(repo, agentId));

  await auditLog(agentId || "org", "list", null);

  return { memories: rows, total };
}

// Reads, shared pools and snapshots live in sibling files, re-exported for import-path back-compat.
export { readMemory, deleteMemory } from "./memory-read.js";
export { sharedWrite, sharedRead } from "./memory-pools.js";
export { createSnapshot, restoreSnapshot } from "./memory-snapshots.js";

// Health/usage diagnostics live in memory-stats.ts, re-exported for import-path back-compat.
export { agentHealth, agentStats } from "./memory-stats.js";
