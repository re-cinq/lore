/**
 * Postgres implementation of the MemoryStore seam.
 *
 * Wraps an injected pg pool. The only backend today; Dgraph arrives
 * as a sibling implementation without touching callers.
 */

import type { MemoryStore, PgPool, WriteResult } from "./memory-store.js";

export class PostgresMemoryStore implements MemoryStore {
  readonly backend = "postgres" as const;

  constructor(private readonly pool: PgPool) {}

  async writeMemory(input: {
    key: string;
    value: string;
    agentId: string;
    ttl?: number;
    embedding?: number[];
    repo?: string;
  }): Promise<WriteResult> {
    const agent = input.agentId;
    const expiresAt = input.ttl
      ? `now() + interval '${input.ttl} seconds'`
      : null;

    // Check if key already exists for this repo (or agent if no repo)
    const lookupField = input.repo ? "repo" : "agent_id";
    const lookupValue = input.repo || agent;
    const existing = await this.pool.query(
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

      await this.pool.query(
        `UPDATE memory.memories
         SET value = $1, version = $2, embedding = $3,
             ttl_seconds = $4, expires_at = ${expiresAt ? expiresAt : "NULL"},
             created_at = now()
         WHERE id = $5`,
        [
          input.value,
          version,
          input.embedding ? `[${input.embedding.join(",")}]` : null,
          input.ttl || null,
          memoryId,
        ],
      );
    } else {
      // New memory
      version = 1;
      const result = await this.pool.query(
        `INSERT INTO memory.memories (agent_id, key, value, embedding, version, ttl_seconds, expires_at, repo)
         VALUES ($1, $2, $3, $4, 1, $5, ${expiresAt ? expiresAt : "NULL"}, $6)
         RETURNING id, created_at`,
        [
          agent,
          input.key,
          input.value,
          input.embedding ? `[${input.embedding.join(",")}]` : null,
          input.ttl || null,
          input.repo || null,
        ],
      );
      memoryId = result.rows[0].id;
    }

    // Always insert a version record
    await this.pool.query(
      `INSERT INTO memory.memory_versions (memory_id, version, value, embedding)
       VALUES ($1, $2, $3, $4)`,
      [
        memoryId,
        version,
        input.value,
        input.embedding ? `[${input.embedding.join(",")}]` : null,
      ],
    );

    // Audit log
    await this.auditLog(agent, "write", input.key);

    const row = await this.pool.query(
      `SELECT created_at FROM memory.memories WHERE id = $1`,
      [memoryId],
    );

    return {
      key: input.key,
      version,
      agent_id: agent,
      created_at: row.rows[0].created_at,
    };
  }

  async readMemory(
    key: string,
    agentId: string,
    version?: string | number,
  ): Promise<any> {
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
  }): Promise<{ memories: any[]; total: number }> {
    const { agentId, repo } = opts;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    // Scope by repo (preferred) or agent_id
    let filter: string;
    let params: any[];
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
    return { memories: rows, total: countResult.rows[0].total };
  }

  private async auditLog(
    agentId: string,
    operation: string,
    key: string | null,
    meta?: any,
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
