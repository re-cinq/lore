import type { PgPool } from "@re-cinq/lore-shared";
import { resolveAgentId } from "../../platform/agent-id.js";
import {
  getMemoryPool,
  runInTransaction,
  toEmbeddingParam,
  auditLog,
  type MemoryWriteInput,
  type WriteResult,
} from "./memory.js";

// Shared pools (PostgreSQL-backed): cross-agent key/value memories grouped under a named pool.

async function getOrCreateSharedPoolId(
  tx: Pick<PgPool, "query">,
  poolName: string,
  agent: string,
): Promise<string> {
  const found = await tx.query(
    `SELECT id FROM memory.shared_pools WHERE name = $1`,
    [poolName],
  );

  if (found.rows.length > 0) {
    return found.rows[0].id as string;
  }

  const created = await tx.query(
    `INSERT INTO memory.shared_pools (name, created_by) VALUES ($1, $2) RETURNING id`,
    [poolName, agent],
  );

  return created.rows[0].id as string;
}

// Same atomicity contract as writeMemory (#1154): pool lookup/create, memories insert, and version insert land in one transaction when the pool provides connect(); a query-only pool stays sequential.
async function insertSharedMemory(
  tx: Pick<PgPool, "query">,
  poolName: string,
  agent: string,
  { key, value, embedding }: Omit<MemoryWriteInput, "ttl" | "repo" | "agentId">,
): Promise<string> {
  const embeddingParam = toEmbeddingParam(embedding);
  const poolId = await getOrCreateSharedPoolId(tx, poolName, agent);
  const result = await tx.query(
    `INSERT INTO memory.memories (agent_id, key, value, embedding, version, pool_id) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id, created_at`,
    [agent, key, value, embeddingParam, poolId],
  );

  await tx.query(
    `INSERT INTO memory.memory_versions (memory_id, version, value, embedding) VALUES ($1, 1, $2, $3)`,
    [result.rows[0].id, value, embeddingParam],
  );

  return result.rows[0].created_at as string;
}

export async function sharedWrite(
  poolName: string,
  input: Omit<MemoryWriteInput, "ttl" | "repo">,
): Promise<WriteResult> {
  const { key, agentId } = input;
  const agent = resolveAgentId(agentId);
  const db = getMemoryPool()!;

  const createdAt = await runInTransaction(db, (tx) =>
    insertSharedMemory(tx, poolName, agent, input),
  );

  await auditLog(agent, "shared_write", key, { pool: poolName });

  return {
    key,
    version: 1,
    agent_id: agent,
    created_at: createdAt,
  };
}

export async function sharedRead(poolName: string, key?: string) {
  const pool = getMemoryPool()!;
  const poolResult = await pool.query(
    `SELECT id FROM memory.shared_pools WHERE name = $1`,
    [poolName],
  );

  if (poolResult.rows.length === 0) {
    return key ? null : [];
  }
  const poolId = poolResult.rows[0].id;

  if (key) {
    const { rows } = await pool.query(
      `SELECT key, value, agent_id, version, created_at FROM memory.memories WHERE pool_id = $1 AND key = $2 AND is_deleted = FALSE ORDER BY version DESC LIMIT 1`,
      [poolId, key],
    );

    return rows[0] || null;
  }
  const { rows } = await pool.query(
    `SELECT key, value, agent_id, version, created_at FROM memory.memories WHERE pool_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 100`,
    [poolId],
  );

  return rows;
}
