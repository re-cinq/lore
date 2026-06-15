import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresMemoryStore } from "../postgres-memory-store.js";

/**
 * PostgresMemoryStore (memory-dgraph-migration AC1) — each method lifts the
 * current SQL from mcp-server/src/memory.ts verbatim, tested against the REAL
 * local Postgres (no mocks). Container-gated: skips when Postgres isn't
 * reachable so `npm test` passes without a container. Bring one up with
 * `npm run db:up`.
 */

const PG_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "lore",
  user: "postgres",
  password: "lore",
};

async function pgReachable(): Promise<boolean> {
  try {
    const probe = new Pool({ ...PG_CONFIG, connectionTimeoutMillis: 1000 });
    await probe.query("select 1");
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const reachable = await pgReachable();

describe.skipIf(!reachable)("PostgresMemoryStore.writeMemory (live Postgres)", () => {
  const pool = new Pool(PG_CONFIG);

  afterAll(async () => {
    await pool.end();
  });

  it("returns version 1 for a brand-new key", async () => {
    const agent = `pgms-test-${randomUUID()}`;
    const store = new PostgresMemoryStore(pool);

    try {
      const res = await store.writeMemory({ key: "kernel-key", value: "v1", agentId: agent });

      expect(res).toMatchObject({ key: "kernel-key", version: 1, agent_id: agent });
      expect(res.created_at).toBeDefined();
    } finally {
      await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [agent]);
      await pool.query(
        `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
        [agent],
      );
      await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [agent]);
    }
  });
});

describe.skipIf(!reachable)("PostgresMemoryStore.deleteMemory (live Postgres)", () => {
  const pool = new Pool(PG_CONFIG);

  afterAll(async () => {
    await pool.end();
  });

  it("soft-deletes so readMemory returns nothing", async () => {
    const agent = `pgms-test-${randomUUID()}`;
    const store = new PostgresMemoryStore(pool);

    try {
      await store.writeMemory({ key: "del-key", value: "x", agentId: agent });
      const res = await store.deleteMemory("del-key", agent);

      expect(res).toEqual({ key: "del-key", deleted: true });
      expect(await store.readMemory("del-key", agent)).toBeFalsy();
    } finally {
      await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [agent]);
      await pool.query(
        `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
        [agent],
      );
      await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [agent]);
    }
  });
});

describe.skipIf(!reachable)("PostgresMemoryStore.listMemories (live Postgres)", () => {
  const pool = new Pool(PG_CONFIG);

  afterAll(async () => {
    await pool.end();
  });

  it("returns total 2 and the two live keys, excluding the soft-deleted one", async () => {
    const agent = `pgms-test-${randomUUID()}`;
    const store = new PostgresMemoryStore(pool);

    try {
      await store.writeMemory({ key: "a", value: "1", agentId: agent });
      await store.writeMemory({ key: "b", value: "2", agentId: agent });
      await store.writeMemory({ key: "gone", value: "3", agentId: agent });
      await store.deleteMemory("gone", agent);

      const out = await store.listMemories({ agentId: agent });

      expect(out.total).toBe(2);
      expect(out.memories.map((memory) => memory.key).sort()).toEqual(["a", "b"]);
    } finally {
      await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [agent]);
      await pool.query(
        `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
        [agent],
      );
      await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [agent]);
    }
  });
});

describe.skipIf(!reachable)("PostgresMemoryStore.readMemory (live Postgres)", () => {
  const pool = new Pool(PG_CONFIG);

  afterAll(async () => {
    await pool.end();
  });

  it("returns the latest stored value with version 1 for a single write", async () => {
    const agent = `pgms-test-${randomUUID()}`;
    const store = new PostgresMemoryStore(pool);

    try {
      await store.writeMemory({ key: "read-key", value: "hello", agentId: agent });
      const got = await store.readMemory("read-key", agent);

      expect(got).toMatchObject({ key: "read-key", value: "hello", version: 1 });
    } finally {
      await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [agent]);
      await pool.query(
        `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
        [agent],
      );
      await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [agent]);
    }
  });
});
