// Shared primitives for the PostgreSQL-backed memory store: pool handle, transaction wrapper, embedding encoding, and the audit writer. memory.ts and its siblings (memory-pools/snapshots/stats) both import here rather than from one another, breaking the cycle a straight split would leave behind.

import { hasConnect } from "@re-cinq/lore-shared";
import type { PgPool } from "@re-cinq/lore-shared";

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

export interface MemoryWriteInput {
  key: string;
  value: string;
  agentId?: string;
  ttl?: number;
  embedding?: number[];
  repo?: string;
}

// ── Embedding encoding ───────────────────────────────────────────────

export function toEmbeddingParam(embedding?: number[]): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
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
