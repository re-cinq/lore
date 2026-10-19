// Shared primitives for the PostgreSQL-backed memory store: pool handle, embedding encoding, and the audit writer. memory.ts and its siblings (memory-pools/snapshots/stats) both import here rather than from one another, breaking the cycle a straight split would leave behind.

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

// The one row a RETURNING/lookup query is expected to have produced; keeps callers off `result.rows[0].col`.
export function firstRow<T>(result: { rows: T[] }): T {
  return result.rows[0];
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
