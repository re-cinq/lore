/**
 * PostgreSQL-backed memory CRUD module.
 *
 * Provides write / read / delete / list operations against the
 * memory.memories, memory.memory_versions, and memory.audit_log tables.
 * Uses the same pool-injection pattern as db.ts.
 */

import { resolveAgentId } from './agent-id.js';

// ── Pool management ──────────────────────────────────────────────────

let pool: any = null;

export function getMemoryPool(): any { return pool; }

export function setMemoryPool(p: any): void {
  pool = p;
}

export function isMemoryDbAvailable(): boolean {
  return pool !== null;
}

// ── Types ────────────────────────────────────────────────────────────

export interface MemoryRow {
  id: string;
  agent_id: string;
  key: string;
  value: string;
  version: number;
  is_deleted: boolean;
  pool_id: string | null;
  ttl_seconds: number | null;
  expires_at: string | null;
  created_at: string;
}

export interface WriteResult {
  key: string;
  version: number;
  agent_id: string;
  created_at: string;
}

// ── Write ────────────────────────────────────────────────────────────

export async function writeMemory(
  key: string,
  value: string,
  agentId?: string,
  ttl?: number,
  embedding?: number[],
  repo?: string,
): Promise<WriteResult> {
  const agent = resolveAgentId(agentId);
  const expiresAt = ttl ? `now() + interval '${ttl} seconds'` : null;

  // Check if key already exists for this repo (or agent if no repo)
  const lookupField = repo ? "repo" : "agent_id";
  const lookupValue = repo || agent;
  const existing = await pool.query(
    `SELECT id, version FROM memory.memories
     WHERE ${lookupField} = $1 AND key = $2 AND is_deleted = FALSE
     ORDER BY version DESC LIMIT 1`,
    [lookupValue, key],
  );

  let version: number;
  let memoryId: string;

  if (existing.rows.length > 0) {
    // Update: increment version
    version = existing.rows[0].version + 1;
    memoryId = existing.rows[0].id;

    await pool.query(
      `UPDATE memory.memories
       SET value = $1, version = $2, embedding = $3,
           ttl_seconds = $4, expires_at = ${expiresAt ? expiresAt : 'NULL'},
           created_at = now()
       WHERE id = $5`,
      [
        value,
        version,
        embedding ? `[${embedding.join(',')}]` : null,
        ttl || null,
        memoryId,
      ],
    );
  } else {
    // New memory
    version = 1;
    const result = await pool.query(
      `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at, repo)
       VALUES ($1, $2, $3, $4, 1, $5, ${expiresAt ? expiresAt : 'NULL'}, $6)
       RETURNING id, created_at`,
      [
        agent,
        key,
        value,
        embedding ? `[${embedding.join(',')}]` : null,
        ttl || null,
        repo || null,
      ],
    );
    memoryId = result.rows[0].id;
  }

  // Always insert a version record
  await pool.query(
    `INSERT INTO memory.memory_versions (memory_id, version, value, embedding)
     VALUES ($1, $2, $3, $4)`,
    [memoryId, version, value, embedding ? `[${embedding.join(',')}]` : null],
  );

  // Audit log
  await auditLog(agent, 'write', key);

  const row = await pool.query(
    `SELECT created_at FROM memory.memories WHERE id = $1`,
    [memoryId],
  );

  return { key, version, agent_id: agent, created_at: row.rows[0].created_at };
}

// ── Read ─────────────────────────────────────────────────────────────

export async function readMemory(
  key: string,
  agentId?: string,
  version?: string | number,
): Promise<any> {
  const agent = resolveAgentId(agentId);

  if (version === 'all') {
    // Return all versions
    const { rows } = await pool.query(
      `SELECT mv.version, mv.value, mv.created_at
       FROM memory.memory_versions mv
       JOIN memory.memories m ON m.id = mv.memory_id
       WHERE m.agent_id = $1 AND m.key = $2
       ORDER BY mv.version DESC`,
      [agent, key],
    );
    await auditLog(agent, 'read', key);
    return rows;
  }

  if (
    typeof version === 'number' ||
    (typeof version === 'string' && !isNaN(Number(version)))
  ) {
    // Specific version
    const { rows } = await pool.query(
      `SELECT mv.version, mv.value, mv.created_at
       FROM memory.memory_versions mv
       JOIN memory.memories m ON m.id = mv.memory_id
       WHERE m.agent_id = $1 AND m.key = $2 AND mv.version = $3`,
      [agent, key, Number(version)],
    );
    await auditLog(agent, 'read', key);
    return rows[0] || null;
  }

  // Latest version
  const { rows } = await pool.query(
    `SELECT key, value, version, created_at
     FROM memory.memories
     WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY version DESC LIMIT 1`,
    [agent, key],
  );
  await auditLog(agent, 'read', key);
  return rows[0] || null;
}

// ── Delete ───────────────────────────────────────────────────────────

export async function deleteMemory(
  key: string,
  agentId?: string,
): Promise<{ key: string; deleted: boolean }> {
  const agent = resolveAgentId(agentId);
  await pool.query(
    `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND key = $2`,
    [agent, key],
  );
  await auditLog(agent, 'delete', key);
  return { key, deleted: true };
}

// ── List ─────────────────────────────────────────────────────────────

export async function listMemories(
  agentId?: string,
  limit: number = 50,
  offset: number = 0,
  repo?: string,
): Promise<{ memories: any[]; total: number }> {
  // Scope by repo (preferred) or agent_id
  let filter = "";
  let params: any[];
  if (repo) {
    filter = "repo = $1 AND";
    params = [repo, limit, offset];
  } else if (agentId) {
    filter = "agent_id = $1 AND";
    params = [resolveAgentId(agentId), limit, offset];
  } else {
    filter = "";
    params = [limit, offset];
  }
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `SELECT key, agent_id, repo, version, created_at, ttl_seconds,
            EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
     FROM memory.memories m
     WHERE ${filter} is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countParams = repo ? [repo] : agentId ? [resolveAgentId(agentId)] : [];
  const countResult = await pool.query(
    `SELECT count(*)::int as total FROM memory.memories
     WHERE ${filter} is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())`,
    countParams,
  );

  await auditLog(agentId || 'org', 'list', null);
  return { memories: rows, total: countResult.rows[0].total };
}

// ── Shared Pools ─────────────────────────────────────────────────────

export async function sharedWrite(poolName: string, key: string, value: string, agentId?: string, embedding?: number[]): Promise<WriteResult> {
  const agent = resolveAgentId(agentId);
  // Get or create pool
  let poolResult = await pool.query(`SELECT id FROM memory.shared_pools WHERE name = $1`, [poolName]);
  if (poolResult.rows.length === 0) {
    poolResult = await pool.query(`INSERT INTO memory.shared_pools (name, created_by) VALUES ($1, $2) RETURNING id`, [poolName, agent]);
  }
  const poolId = poolResult.rows[0].id;
  // Write memory with pool_id
  const result = await pool.query(`INSERT INTO memory.memories (agent_id, key, value, embedding, version, pool_id) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id, created_at`, [agent, key, value, embedding ? `[${embedding.join(',')}]` : null, poolId]);
  await pool.query(`INSERT INTO memory.memory_versions (memory_id, version, value, embedding) VALUES ($1, 1, $2, $3)`, [result.rows[0].id, value, embedding ? `[${embedding.join(',')}]` : null]);
  await auditLog(agent, 'shared_write', key, { pool: poolName });
  return { key, version: 1, agent_id: agent, created_at: result.rows[0].created_at };
}

export async function sharedRead(poolName: string, key?: string): Promise<any> {
  const poolResult = await pool.query(`SELECT id FROM memory.shared_pools WHERE name = $1`, [poolName]);
  if (poolResult.rows.length === 0) return key ? null : [];
  const poolId = poolResult.rows[0].id;
  if (key) {
    const { rows } = await pool.query(`SELECT key, value, agent_id, version, created_at FROM memory.memories WHERE pool_id = $1 AND key = $2 AND is_deleted = FALSE ORDER BY version DESC LIMIT 1`, [poolId, key]);
    return rows[0] || null;
  }
  const { rows } = await pool.query(`SELECT key, value, agent_id, version, created_at FROM memory.memories WHERE pool_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 100`, [poolId]);
  return rows;
}

// ── Snapshots ────────────────────────────────────────────────────────

export async function createSnapshot(agentId?: string): Promise<any> {
  const agent = resolveAgentId(agentId);
  const { rows: memories } = await pool.query(`SELECT id, version FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE AND (expires_at IS NULL OR expires_at > now())`, [agent]);
  const memoryRefs = memories.map((m: any) => ({ memory_id: m.id, version: m.version }));
  const { rows } = await pool.query(`INSERT INTO memory.snapshots (agent_id, memory_refs, trigger) VALUES ($1, $2, 'manual') RETURNING id, created_at`, [agent, JSON.stringify(memoryRefs)]);
  await auditLog(agent, 'snapshot', null, { snapshot_id: rows[0].id, memory_count: memoryRefs.length });
  return { snapshot_id: rows[0].id, agent_id: agent, memory_count: memoryRefs.length, created_at: rows[0].created_at };
}

export async function restoreSnapshot(snapshotId: string): Promise<any> {
  const { rows: snaps } = await pool.query(`SELECT agent_id, memory_refs, created_at FROM memory.snapshots WHERE id = $1`, [snapshotId]);
  if (snaps.length === 0) throw new Error('Snapshot not found');
  const snap = snaps[0];
  const refs = snap.memory_refs as Array<{memory_id: string, version: number}>;
  const refIds = refs.map(r => r.memory_id);
  // Revert each memory to snapshotted version
  for (const ref of refs) {
    const { rows: ver } = await pool.query(`SELECT value, embedding FROM memory.memory_versions WHERE memory_id = $1 AND version = $2`, [ref.memory_id, ref.version]);
    if (ver.length > 0) {
      await pool.query(`UPDATE memory.memories SET value = $1, version = $2, embedding = $3, is_deleted = FALSE WHERE id = $4`, [ver[0].value, ref.version, ver[0].embedding, ref.memory_id]);
    }
  }
  // Soft-delete memories created after snapshot that aren't in refs
  await pool.query(`UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND id != ALL($2::uuid[]) AND created_at > $3`, [snap.agent_id, refIds, snap.created_at]);
  await auditLog(snap.agent_id, 'restore', null, { snapshot_id: snapshotId, restored_count: refs.length });
  return { snapshot_id: snapshotId, memories_restored: refs.length, snapshot_created_at: snap.created_at };
}

// ── Health & Stats ───────────────────────────────────────────────────

export async function agentHealth(agentId?: string): Promise<any> {
  const agent = resolveAgentId(agentId);
  const { rows } = await pool.query(`
    SELECT count(*)::int as memory_count,
           max(created_at) as last_active,
           (SELECT count(*)::int FROM memory.snapshots WHERE agent_id = $1) as snapshot_count
    FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE
  `, [agent]);
  return { agent_id: agent, ...rows[0] };
}

export async function agentStats(agentId?: string): Promise<any> {
  const agent = resolveAgentId(agentId);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM memory.memories WHERE agent_id = $1 AND is_deleted = FALSE) as total_memories,
      (SELECT count(*)::int FROM memory.facts f JOIN memory.memories m ON f.memory_id = m.id WHERE m.agent_id = $1) as total_facts,
      (SELECT count(*)::int FROM memory.facts f JOIN memory.memories m ON f.memory_id = m.id WHERE m.agent_id = $1 AND f.valid_to IS NULL) as active_facts,
      (SELECT count(*)::int FROM memory.facts f JOIN memory.memories m ON f.memory_id = m.id WHERE m.agent_id = $1 AND f.valid_to IS NOT NULL) as invalidated_facts,
      (SELECT count(*)::int FROM memory.audit_log WHERE agent_id = $1 AND operation = 'search') as total_searches,
      (SELECT count(DISTINCT name) FROM memory.shared_pools WHERE created_by = $1) as shared_pools_created
  `, [agent]);
  return { agent_id: agent, ...rows[0] };
}

// ── Audit helper ─────────────────────────────────────────────────────

async function auditLog(
  agentId: string,
  operation: string,
  key: string | null,
  meta?: any,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO memory.audit_log (agent_id, operation, memory_key, metadata)
       VALUES ($1, $2, $3, $4)`,
      [agentId, operation, key, meta ? JSON.stringify(meta) : null],
    );
  } catch {
    // Audit failures must never block operations
  }
}
