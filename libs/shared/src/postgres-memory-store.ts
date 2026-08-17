/**
 * Postgres implementation of the MemoryStore seam.
 *
 * Wraps an injected pg pool. The only backend today; Dgraph arrives
 * as a sibling implementation without touching callers.
 */

import { hasConnect } from "./memory-store.js";
import type {
  MemoryRecord,
  MemoryStore,
  PgPool,
  WriteResult,
} from "./memory-store.js";

interface UpsertInput {
  key: string;
  value: string;
  agentId: string;
  ttl?: number;
  embedding?: number[];
  repo?: string;
}

async function upsertMemoryWithVersion(
  db: Pick<PgPool, "query">,
  input: UpsertInput,
): Promise<{ memoryId: string; version: number }> {
  const embedding = input.embedding ? `[${input.embedding.join(",")}]` : null;
  const ttlSeconds = input.ttl || null;

  // Check if key already exists for this repo (or agent if no repo)
  const lookupField = input.repo ? "repo" : "agent_id";
  const lookupValue = input.repo || input.agentId;
  const existing = await db.query<{ version: number; id: string }>(
    `SELECT id, version FROM memory.memories
     WHERE ${lookupField} = $1 AND key = $2 AND is_deleted = FALSE
     ORDER BY version DESC LIMIT 1`,
    [lookupValue, input.key],
  );

  let version: number;
  let memoryId: string;

  if (existing.rows.length > 0) {
    // Update: increment version
    version = existing.rows[0].version + 1;
    memoryId = existing.rows[0].id;

    await db.query(
      `UPDATE memory.memories
       SET value = $1, version = $2, embedding = $3,
           ttl_seconds = $4, expires_at = now() + make_interval(secs => $5),
           created_at = now()
       WHERE id = $6`,
      [input.value, version, embedding, ttlSeconds, ttlSeconds, memoryId],
    );
  } else {
    // New memory
    version = 1;
    const result = await db.query<{ id: string }>(
      `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at, repo)
       VALUES ($1, $2, $3, $4, 1, $5, now() + make_interval(secs => $6), $7)
       RETURNING id, created_at`,
      [
        input.agentId,
        input.key,
        input.value,
        embedding,
        ttlSeconds,
        ttlSeconds,
        input.repo || null,
      ],
    );

    memoryId = result.rows[0].id;
  }

  // Always insert a version record
  await db.query(
    `INSERT INTO memory.memory_versions (memory_id, version, value, embedding)
     VALUES ($1, $2, $3, $4)`,
    [memoryId, version, input.value, embedding],
  );

  return { memoryId, version };
}

export class PostgresMemoryStore implements MemoryStore {
  readonly backend = "postgres" as const;

  constructor(private readonly pool: PgPool) {}

  async writeMemory(input: UpsertInput): Promise<WriteResult> {
    const agent = input.agentId;

    // The memories row and its version row must land together (#1154): with a
    // connect()-capable pool the upsert runs in one transaction; a query-only
    // pool keeps the plain sequential path.
    const client = hasConnect(this.pool) ? await this.pool.connect() : null;
    let memoryId: string;
    let version: number;

    try {
      if (client) {
        await client.query("BEGIN");
      }

      ({ memoryId, version } = await upsertMemoryWithVersion(
        client ?? this.pool,
        input,
      ));

      if (client) {
        await client.query("COMMIT");
      }
    } catch (err) {
      // Best-effort: the connection may already be dead, and that failure must
      // not mask the original error.
      await client?.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client?.release();
    }

    await this.auditLog(agent, "write", input.key);

    const row = await this.pool.query(
      `SELECT created_at FROM memory.memories WHERE id = $1`,
      [memoryId],
    );

    return {
      key: input.key,
      version,
      agent_id: agent,
      created_at: row.rows[0].created_at as string,
    };
  }

  async readMemory(
    key: string,
    agentId: string,
    version?: string | number,
  ): Promise<MemoryRecord | MemoryRecord[] | null> {
    const agent = agentId;

    if (version === "all") {
      // Return all versions
      const { rows } = await this.pool.query(
        `SELECT mv.version, mv.value, mv.created_at
         FROM memory.memory_versions mv
         JOIN memory.memories m ON m.id = mv.memory_id
         WHERE m.agent_id = $1 AND m.key = $2
         ORDER BY mv.version DESC`,
        [agent, key],
      );

      await this.auditLog(agent, "read", key);

      return rows;
    }

    if (
      typeof version === "number" ||
      (typeof version === "string" && !isNaN(Number(version)))
    ) {
      // Specific version
      const { rows } = await this.pool.query(
        `SELECT mv.version, mv.value, mv.created_at
         FROM memory.memory_versions mv
         JOIN memory.memories m ON m.id = mv.memory_id
         WHERE m.agent_id = $1 AND m.key = $2 AND mv.version = $3`,
        [agent, key, Number(version)],
      );

      await this.auditLog(agent, "read", key);

      return rows[0] || null;
    }

    // Latest version
    const { rows } = await this.pool.query(
      `SELECT key, value, version, created_at
       FROM memory.memories
       WHERE agent_id = $1 AND key = $2 AND is_deleted = FALSE
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY version DESC LIMIT 1`,
      [agent, key],
    );

    await this.auditLog(agent, "read", key);

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

  async listMemories(opts: {
    agentId?: string;
    limit?: number;
    offset?: number;
    repo?: string;
  }): Promise<{ memories: MemoryRecord[]; total: number }> {
    const { agentId, repo } = opts;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    // Scope by repo (preferred) or agent_id
    let filter: string;
    let params: unknown[];

    if (repo) {
      filter = "repo = $1 AND";
      params = [repo, limit, offset];
    } else if (agentId) {
      filter = "agent_id = $1 AND";
      params = [agentId, limit, offset];
    } else {
      filter = "";
      params = [limit, offset];
    }

    const { rows } = await this.pool.query(
      `SELECT key, agent_id, repo, version, created_at, ttl_seconds,
              EXISTS(SELECT 1 FROM memory.facts f WHERE f.memory_id = m.id) as has_facts
       FROM memory.memories m
       WHERE ${filter} is_deleted = FALSE
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countParams = repo ? [repo] : agentId ? [agentId] : [];
    const countResult = await this.pool.query(
      `SELECT count(*)::int as total FROM memory.memories
       WHERE ${filter} is_deleted = FALSE
         AND (expires_at IS NULL OR expires_at > now())`,
      countParams,
    );

    await this.auditLog(agentId || "org", "list", null);

    return { memories: rows, total: countResult.rows[0].total as number };
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
