/** Postgres implementation of the MemoryStore seam, wrapping an injected pg pool; the only backend today — Dgraph arrives as a sibling implementation without touching callers. */

import { hasConnect } from "../domain/memory-store-types.js";
import type {
  MemoryRecord,
  MemoryStore,
  MemoryTxClient,
  PgPool,
  WriteResult,
} from "../domain/memory-store-types.js";

import {
  upsertMemoryWithVersion,
  type UpsertInput,
} from "./postgres-memory-upsert.js";

function isNumericVersion(version: string | number | undefined): boolean {
  return (
    typeof version === "number" ||
    (typeof version === "string" && !isNaN(Number(version)))
  );
}

/** The `WHERE` prefix and bound params a memory listing is scoped by — repo wins over agent, and an unscoped list binds only the page. */
export function memoryListScope(
  repo: string | undefined,
  agentId: string | undefined,
  limit: number,
  offset: number,
): { filter: string; params: unknown[] } {
  if (repo) {
    return { filter: "repo = $1 AND", params: [repo, limit, offset] };
  }

  if (agentId) {
    return { filter: "agent_id = $1 AND", params: [agentId, limit, offset] };
  }

  return { filter: "", params: [limit, offset] };
}

interface ListMemoriesOpts {
  agentId?: string;
  limit?: number;
  offset?: number;
  repo?: string;
}

/** The page read carries the scope filter and its own placeholder numbering, which shifts with the scope: an unscoped list has two params, a scoped one three. */
function listMemoriesSql(filter: string, params: unknown[]): string {
  return `SELECT key, agent_id, repo, version, created_at, ttl_seconds,
              EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
       FROM memory.memories m
       WHERE ${filter} is_deleted = FALSE
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`;
}

async function beginIfClient(client: MemoryTxClient | null): Promise<void> {
  if (client) {
    await client.query("BEGIN");
  }
}

async function commitIfClient(client: MemoryTxClient | null): Promise<void> {
  if (client) {
    await client.query("COMMIT");
  }
}

// The memories row and its version row must land together (#1154): a connect()-capable pool runs the upsert in one transaction; a query-only pool stays sequential.
async function upsertMemoryTransactionally(
  pool: PgPool,
  input: UpsertInput,
): Promise<{ memoryId: string; version: number }> {
  const client = hasConnect(pool) ? await pool.connect() : null;

  try {
    await beginIfClient(client);

    const result = await upsertMemoryWithVersion(client ?? pool, input);

    await commitIfClient(client);

    return result;
  } catch (err) {
    // Best-effort: the connection may already be dead, and that failure must not mask the original error.
    await client?.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client?.release();
  }
}

const HISTORY_SQL = `SELECT mv.version, mv.value, mv.created_at
         FROM memory.memory_versions mv
         JOIN memory.memories m ON m.id = mv.memory_id
         WHERE m.agent_id = $1 AND m.key = $2
         ORDER BY mv.version DESC`;

const HISTORY_SQL_BY_VERSION = `SELECT mv.version, mv.value, mv.created_at
         FROM memory.memory_versions mv
         JOIN memory.memories m ON m.id = mv.memory_id
         WHERE m.agent_id = $1 AND m.key = $2 AND mv.version = $3`;

const CURRENT_VERSION_SQL = `SELECT key, value, version, created_at
       FROM memory.memories
       WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY version DESC LIMIT 1`;

export class PostgresMemoryStore implements MemoryStore {
  readonly backend = "postgres" as const;

  constructor(private readonly pool: PgPool) {}

  async writeMemory(input: UpsertInput): Promise<WriteResult> {
    const agent = input.agentId;
    const { memoryId, version } = await upsertMemoryTransactionally(
      this.pool,
      input,
    );

    await this.auditLog(agent, "write", input.key);

    const { rows } = await this.pool.query(
      `SELECT created_at FROM memory.memories WHERE id = $1`,
      [memoryId],
    );

    return {
      key: input.key,
      version,
      agent_id: agent,
      created_at: rows[0].created_at as string,
    };
  }

  async readMemory(
    key: string,
    agentId: string,
    version?: string | number,
  ): Promise<MemoryRecord | MemoryRecord[] | null> {
    const agent = agentId;
    // Every branch is audited, including the ones that find nothing: a read that missed is still a read somebody made.
    const found = await this.readVersions(key, agent, version);

    await this.auditLog(agent, "read", key);

    return found;
  }

  /** All versions, one version, or the current one — the history table answers the first two, the live row the third. A soft-deleted or expired memory is invisible to the current-version read but still present in its history, which is what makes "what did this key say last week" answerable after a delete. */
  private async readVersions(
    key: string,
    agent: string,
    version?: string | number,
  ): Promise<MemoryRecord | MemoryRecord[] | null> {
    if (version === "all") {
      const { rows } = await this.pool.query(HISTORY_SQL, [agent, key]);

      return rows;
    }

    if (isNumericVersion(version)) {
      const { rows } = await this.pool.query(`${HISTORY_SQL_BY_VERSION}`, [
        agent,
        key,
        Number(version),
      ]);

      return rows[0] || null;
    }

    const { rows } = await this.pool.query(CURRENT_VERSION_SQL, [agent, key]);

    return rows[0] || null;
  }

  async deleteMemory(
    key: string,
    agentId: string,
  ): Promise<{ key: string; deleted: boolean }> {
    const agent = agentId;

    await this.pool.query(
      `UPDATE memory.memories SET is_deleted = TRUE WHERE agent_id = $1 AND key = $2`,
      [agent, key],
    );
    await this.auditLog(agent, "delete", key);

    return { key, deleted: true };
  }

  async listMemories(
    opts: ListMemoriesOpts,
  ): Promise<{ memories: MemoryRecord[]; total: number }> {
    const { agentId, repo } = opts;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    // Scope by repo (preferred) or agent_id
    const { filter, params } = memoryListScope(repo, agentId, limit, offset);
    const { rows } = await this.pool.query(
      listMemoriesSql(filter, params),
      params,
    );
    const total = await this.countInScope(filter, repo || agentId);

    await this.auditLog(agentId || "org", "list", null);

    return { memories: rows, total };
  }

  /** How many memories the same scope holds, ignoring the page window — the caller needs it to know there is a next page at all. Deliberately a second query rather than a window function: the page read is the hot path, and it should not carry a full count. */
  private async countInScope(
    filter: string,
    scopeKey: string | undefined,
  ): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int as total FROM memory.memories
       WHERE ${filter} is_deleted = FALSE
         AND (expires_at IS NULL OR expires_at > now())`,
      scopeKey ? [scopeKey] : [],
    );

    return rows[0].total as number;
  }

  private async auditLog(
    agentId: string,
    operation: string,
    key: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO memory.audit_log (agent_id, operation, memory_key, metadata)
         VALUES ($1, $2, $3, $4)`,
        [agentId, operation, key, meta ? JSON.stringify(meta) : null],
      );
    } catch {
      // Audit failures must never block operations
    }
  }
}
