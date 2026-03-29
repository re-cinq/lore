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
): Promise<WriteResult> {
  const agent = resolveAgentId(agentId);
  const expiresAt = ttl ? `now() + interval '${ttl} seconds'` : null;

  // Check if key already exists for this agent
  const existing = await pool.query(
    `SELECT id, version FROM memory.memories
     WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE
     ORDER BY version DESC LIMIT 1`,
    [agent, key],
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
      `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at)
       VALUES ($1, $2, $3, $4, 1, $5, ${expiresAt ? expiresAt : 'NULL'})
       RETURNING id, created_at`,
      [
        agent,
        key,
        value,
        embedding ? `[${embedding.join(',')}]` : null,
        ttl || null,
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
): Promise<{ memories: any[]; total: number }> {
  const agent = resolveAgentId(agentId);

  const { rows } = await pool.query(
    `SELECT key, version, created_at, ttl_seconds,
            EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
     FROM memory.memories m
     WHERE agent_id = $1 AND is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [agent, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT count(*)::int as total FROM memory.memories
     WHERE agent_id = $1 AND is_deleted = FALSE
       AND (expires_at IS NULL OR expires_at > now())`,
    [agent],
  );

  await auditLog(agent, 'list', null);
  return { memories: rows, total: countResult.rows[0].total };
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
