import { hasConnect } from "@re-cinq/lore-shared";
import type { PgPool } from "@re-cinq/lore-shared";
// PostgreSQL-backed memory CRUD: write/read/delete/list against memory.memories, memory.memory_versions, and memory.audit_log, using the same pool-injection pattern as db.ts.

import { resolveAgentId } from "../../platform/agent-id.js";

// ── Pool management ──────────────────────────────────────────────────

let pool: PgPool | null = null;

export function getMemoryPool(): PgPool | null {
  return pool;
}

export function setMemoryPool(p: PgPool | null): void {
  pool = p;
}

export function isMemoryDbAvailable(): boolean {
  return pool !== null;
}

// ── Types ────────────────────────────────────────────────────────────

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

// ── Write ────────────────────────────────────────────────────────────

export function toEmbeddingParam(embedding?: number[]): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}

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

async function upsertMemoryWithVersion(
  db: Pick<PgPool, "query">,
  { key, value, agent, ttl, embedding, repo }: UpsertArgs,
): Promise<{ memoryId: string; version: number }> {
  const embeddingParam = toEmbeddingParam(embedding);
  const ttlSeconds = ttl || null;
  const lookup = resolveLookup(repo, agent);
  const existing = await db.query(
    `SELECT id, version FROM memory.memories
     WHERE ${lookup.field} = $1 AND key = $2 AND is_deleted = FALSE
     ORDER BY version DESC LIMIT 1`,
    [lookup.value, key],
  );

  if (existing.rows.length > 0) {
    // Update: increment version
    const version = (existing.rows[0].version as number) + 1;
    const memoryId = existing.rows[0].id as string;

    await db.query(
      `UPDATE memory.memories
       SET value = $1, version = $2, embedding = $3,
           ttl_seconds = $4, expires_at = now() + make_interval(secs => $5),
           created_at = now()
       WHERE id = $6`,
      [value, version, embeddingParam, ttlSeconds, ttlSeconds, memoryId],
    );
    await insertVersionRecord(db, { memoryId, version, value, embeddingParam });

    return { memoryId, version };
  }

  // New memory
  const version = 1;
  const result = await db.query(
    `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at, repo)
     VALUES ($1, $2, $3, $4, 1, $5, now() + make_interval(secs => $6), $7)
     RETURNING id, created_at`,
    [agent, key, value, embeddingParam, ttlSeconds, ttlSeconds, repo || null],
  );
  const memoryId = result.rows[0].id as string;

  await insertVersionRecord(db, { memoryId, version, value, embeddingParam });

  return { memoryId, version };
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

export interface MemoryWriteInput {
  key: string;
  value: string;
  agentId?: string;
  ttl?: number;
  embedding?: number[];
  repo?: string;
}

// The memories row and its version row must land together — prod ran for months with sequential writes leaving version-less memories behind (#1154); hasConnect feature-detects connect(), a pool without it keeps the plain sequential path.
export async function runInTransaction<T>(
  db: PgPool,
  work: (tx: Pick<PgPool, "query">) => Promise<T>,
): Promise<T> {
  if (!hasConnect(db)) {
    return work(db);
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await work(client);

    await client.query("COMMIT");

    return result;
  } catch (err) {
    // Best-effort: the connection may already be dead, and that failure must not mask the original error.
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function writeMemory({
  key,
  value,
  agentId,
  ttl,
  embedding,
  repo,
}: MemoryWriteInput): Promise<WriteResult> {
  const agent = resolveAgentId(agentId);
  const db = pool!;

  const { memoryId, version } = await runInTransaction(db, (tx) =>
    upsertMemoryWithVersion(tx, { key, value, agent, ttl, embedding, repo }),
  );

  await auditLog(agent, "write", key);

  const row = await pool!.query(
    `SELECT created_at FROM memory.memories WHERE id = $1`,
    [memoryId],
  );

  return {
    key,
    version,
    agent_id: agent,
    created_at: row.rows[0].created_at as string,
  };
}

// ── Read ─────────────────────────────────────────────────────────────

function isVersionNumberLike(version: string | number | undefined): boolean {
  return (
    typeof version === "number" ||
    (typeof version === "string" && !isNaN(Number(version)))
  );
}

async function readAllVersions(agent: string, key: string) {
  const { rows } = await pool!.query(
    `SELECT mv.version, mv.value, mv.created_at
     FROM memory.memory_versions mv
     JOIN memory.memories m ON m.id = mv.memory_id
     WHERE m.agent_id = $1 AND m.key = $2
     ORDER BY mv.version DESC`,
    [agent, key],
  );

  return rows;
}

// `m.key` is selected so one-version read answers the same shape as a latest read — the endpoint declares one contract for `action: "read"`.
async function readVersionAt(agent: string, key: string, version: number) {
  const { rows } = await pool!.query(
    `SELECT m.key, mv.version, mv.value, mv.created_at
     FROM memory.memory_versions mv
     JOIN memory.memories m ON m.id = mv.memory_id
     WHERE m.agent_id = $1 AND m.key = $2 AND mv.version = $3`,
    [agent, key, version],
  );

  return rows[0] || null;
}

async function readLatestVersion(agent: string, key: string) {
  const { rows } = await pool!.query(
    `SELECT key, value, version, created_at
     FROM memory.memories
     WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY version DESC LIMIT 1`,
    [agent, key],
  );

  return rows[0] || null;
}

export async function readMemory(
  key: string,
  agentId?: string,
  version?: string | number,
) {
  const agent = resolveAgentId(agentId);

  if (version === "all") {
    const rows = await readAllVersions(agent, key);

    await auditLog(agent, "read", key);

    return rows;
  }

  if (isVersionNumberLike(version)) {
    const row = await readVersionAt(agent, key, Number(version));

    await auditLog(agent, "read", key);

    return row;
  }

  const row = await readLatestVersion(agent, key);

  await auditLog(agent, "read", key);

  return row;
}

// ── Delete ───────────────────────────────────────────────────────────

export async function deleteMemory(
  key: string,
  agentId?: string,
): Promise<{ key: string; deleted: boolean }> {
  const agent = resolveAgentId(agentId);

  await pool!.query(
    `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND key = $2`,
    [agent, key],
  );
  await auditLog(agent, "delete", key);

  return { key, deleted: true };
}

// ── List ─────────────────────────────────────────────────────────────

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

export async function listMemories(
  agentId?: string,
  limit: number = 50,
  offset: number = 0,
  repo?: string,
): Promise<{ memories: Record<string, unknown>[]; total: number }> {
  // Scope by repo (preferred) or agent_id
  const { filter, params } = listScope(repo, agentId, limit, offset);

  const { rows } = await pool!.query(
    `SELECT key, agent_id, repo, version, created_at, ttl_seconds,
            EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
     FROM memory.memories m
     WHERE ${filter} is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countParams = countScopeParams(repo, agentId);
  const countResult = await pool!.query(
    `SELECT count(*)::int as total FROM memory.memories
     WHERE ${filter} is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())`,
    countParams,
  );

  await auditLog(agentId || "org", "list", null);

  return { memories: rows, total: countResult.rows[0].total as number };
}

// Shared pools + snapshots (PostgreSQL-backed) live in sibling files, re-exported for import-path back-compat.
export { sharedWrite, sharedRead } from "./memory-pools.js";
export { createSnapshot, restoreSnapshot } from "./memory-snapshots.js";

// Health/usage diagnostics live in memory-stats.ts, re-exported for import-path back-compat.
export { agentHealth, agentStats } from "./memory-stats.js";

// ── Audit helper ─────────────────────────────────────────────────────

export async function auditLog(
  agentId: string,
  operation: string,
  key: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await pool!.query(
      `INSERT INTO memory.audit_log (agent_id, operation, memory_key, metadata)
       VALUES ($1, $2, $3, $4)`,
      [agentId, operation, key, meta ? JSON.stringify(meta) : null],
    );
  } catch {
    // Audit failures must never block operations
  }
}
