import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresMemoryStore } from "./postgres-memory-store.js";

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

describe.skipIf(!reachable)(
  "PostgresMemoryStore.writeMemory (live Postgres)",
  () => {
    const pool = new Pool(PG_CONFIG);

    afterAll(async () => {
      await pool.end();
    });

    it("returns version 1 for a brand-new key", async () => {
      const agent = `pgms-test-${randomUUID()}`;
      const store = new PostgresMemoryStore(pool);

      try {
        const res = await store.writeMemory({
          key: "kernel-key",
          value: "v1",
          agentId: agent,
        });

        expect(res).toMatchObject({
          key: "kernel-key",
          version: 1,
          agent_id: agent,
        });
        expect(res.created_at).toBeDefined();
      } finally {
        await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [
          agent,
        ]);
        await pool.query(
          `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
          [agent],
        );
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });
  },
);

describe.skipIf(!reachable)(
  "PostgresMemoryStore.deleteMemory (live Postgres)",
  () => {
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
        await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [
          agent,
        ]);
        await pool.query(
          `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
          [agent],
        );
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });
  },
);

describe.skipIf(!reachable)(
  "PostgresMemoryStore.listMemories (live Postgres)",
  () => {
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
        expect(out.memories.map((memory) => memory.key).sort()).toEqual([
          "a",
          "b",
        ]);
      } finally {
        await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [
          agent,
        ]);
        await pool.query(
          `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
          [agent],
        );
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });
  },
);

describe.skipIf(!reachable)(
  "PostgresMemoryStore.readMemory (live Postgres)",
  () => {
    const pool = new Pool(PG_CONFIG);

    afterAll(async () => {
      await pool.end();
    });

    it("returns the latest stored value with version 1 for a single write", async () => {
      const agent = `pgms-test-${randomUUID()}`;
      const store = new PostgresMemoryStore(pool);

      try {
        await store.writeMemory({
          key: "read-key",
          value: "hello",
          agentId: agent,
        });
        const got = await store.readMemory("read-key", agent);

        expect(got).toMatchObject({
          key: "read-key",
          value: "hello",
          version: 1,
        });
      } finally {
        await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [
          agent,
        ]);
        await pool.query(
          `DELETE FROM memory.memory_versions
         WHERE memory_id IN (SELECT id FROM memory.memories WHERE agent_id = $1)`,
          [agent],
        );
        await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
          agent,
        ]);
      }
    });
  },
);

interface RecordedCall {
  sql: string;
  params: unknown[];
}

function txPool(opts?: {
  versionInsertError?: Error;
  existing?: { id: string; version: number };
}) {
  const clientCalls: RecordedCall[] = [];
  const poolCalls: RecordedCall[] = [];

  function clientRows(sql: string): unknown[] {
    if (/SELECT id, version FROM memory\.memories/.test(sql)) {
      return opts?.existing ? [opts.existing] : [];
    }

    if (/INSERT INTO memory\.memories/.test(sql)) {
      return [{ id: "mem-tx-1", created_at: "2026-08-17" }];
    }

    return [];
  }

  const client = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> {
      clientCalls.push({ sql, params });

      if (
        opts?.versionInsertError &&
        /INSERT INTO memory\.memory_versions/.test(sql)
      ) {
        throw opts.versionInsertError;
      }

      return { rows: clientRows(sql) as T[] };
    },
    release: vi.fn(),
  };
  const scripted = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> {
      poolCalls.push({ sql, params });
      const rows: unknown[] = /SELECT created_at FROM memory\.memories/.test(
        sql,
      )
        ? [{ created_at: "2026-08-17" }]
        : [];

      return { rows: rows as T[] };
    },
    connect: vi.fn(async () => client),
    clientCalls,
    poolCalls,
    client,
  };

  return scripted;
}

function barePool(scripts: { match: RegExp; rows: unknown[] }[]) {
  const calls: RecordedCall[] = [];
  const pool = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: T[] }> {
      calls.push({ sql, params });
      const hit = scripts.find((s) => s.match.test(sql));

      return { rows: (hit ? hit.rows : []) as T[] };
    },
    calls,
  };

  return pool;
}

describe("PostgresMemoryStore.writeMemory transactional write", () => {
  it("commits the memories insert and the version insert in one transaction", async () => {
    const pool = txPool();
    const store = new PostgresMemoryStore(pool);

    const res = await store.writeMemory({
      key: "tx-key",
      value: "tx-value",
      agentId: "agent-tx",
    });

    expect(res).toEqual({
      key: "tx-key",
      version: 1,
      agent_id: "agent-tx",
      created_at: "2026-08-17",
    });

    const sqls = pool.clientCalls.map((c) => c.sql);

    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.at(-1)).toBe("COMMIT");
    expect(sqls.some((s) => /INSERT INTO memory\.memories/.test(s))).toBe(true);
    expect(
      sqls.some((s) => /INSERT INTO memory\.memory_versions/.test(s)),
    ).toBe(true);
    expect(pool.client.release).toHaveBeenCalled();
  });

  it("rolls back the memories insert when the version insert fails", async () => {
    const pool = txPool({
      versionInsertError: new Error(
        'relation "memory.memory_versions" does not exist',
      ),
    });
    const store = new PostgresMemoryStore(pool);

    await expect(
      store.writeMemory({
        key: "tx-key",
        value: "tx-value",
        agentId: "agent-tx",
      }),
    ).rejects.toThrow('relation "memory.memory_versions" does not exist');

    const sqls = pool.clientCalls.map((c) => c.sql);

    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(pool.poolCalls).toEqual([]);
    expect(pool.client.release).toHaveBeenCalled();
  });

  it("rolls back the version-bump update when the version insert fails", async () => {
    const pool = txPool({
      versionInsertError: new Error(
        'relation "memory.memory_versions" does not exist',
      ),
      existing: { id: "mem-tx-2", version: 3 },
    });
    const store = new PostgresMemoryStore(pool);

    await expect(
      store.writeMemory({
        key: "tx-key",
        value: "tx-value",
        agentId: "agent-tx",
      }),
    ).rejects.toThrow('relation "memory.memory_versions" does not exist');

    const sqls = pool.clientCalls.map((c) => c.sql);

    expect(sqls.some((s) => /UPDATE memory\.memories/.test(s))).toBe(true);
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(pool.poolCalls).toEqual([]);
    expect(pool.client.release).toHaveBeenCalled();
  });

  it("writes sequentially through the bare pool when it has no connect()", async () => {
    const pool = barePool([
      { match: /SELECT id, version FROM memory\.memories/, rows: [] },
      {
        match: /INSERT INTO memory\.memories/,
        rows: [{ id: "mem-seq-1", created_at: "2026-08-17" }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-08-17" }],
      },
    ]);
    const store = new PostgresMemoryStore(pool);

    const res = await store.writeMemory({
      key: "seq-key",
      value: "seq-value",
      agentId: "agent-seq",
    });

    expect(res).toEqual({
      key: "seq-key",
      version: 1,
      agent_id: "agent-seq",
      created_at: "2026-08-17",
    });
    expect(
      pool.calls.some((c) => /INSERT INTO memory\.memory_versions/.test(c.sql)),
    ).toBe(true);
    expect(pool.calls.some((c) => c.sql === "BEGIN")).toBe(false);
  });
});

describe("PostgresMemoryStore.writeMemory ttl parameterization", () => {
  it("binds ttl 3600 as a make_interval parameter on a fresh insert", async () => {
    const pool = barePool([
      { match: /SELECT id, version FROM memory\.memories/, rows: [] },
      {
        match: /INSERT INTO memory\.memories/,
        rows: [{ id: "mem-ttl-1", created_at: "2026-08-17" }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-08-17" }],
      },
    ]);
    const store = new PostgresMemoryStore(pool);

    await store.writeMemory({
      key: "ttl-key",
      value: "ttl-value",
      agentId: "agent-ttl",
      ttl: 3600,
    });

    const insert = pool.calls.find((c) =>
      /INSERT INTO memory\.memories/.test(c.sql),
    );

    expect(insert?.sql).toMatch(/make_interval\(secs => \$\d+\)/);
    expect(insert?.sql).not.toMatch(/3600/);
    expect(insert?.params).toEqual([
      "agent-ttl",
      "ttl-key",
      "ttl-value",
      null,
      3600,
      3600,
      null,
    ]);
  });

  it("binds ttl 3600 as a make_interval parameter on a version bump", async () => {
    const pool = barePool([
      {
        match: /SELECT id, version FROM memory\.memories/,
        rows: [{ id: "mem-ttl-1", version: 1 }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-08-17" }],
      },
    ]);
    const store = new PostgresMemoryStore(pool);

    await store.writeMemory({
      key: "ttl-key",
      value: "ttl-value",
      agentId: "agent-ttl",
      ttl: 3600,
    });

    const update = pool.calls.find((c) =>
      /UPDATE memory\.memories/.test(c.sql),
    );

    expect(update?.sql).toMatch(/make_interval\(secs => \$\d+\)/);
    expect(update?.sql).not.toMatch(/3600/);
    expect(update?.params).toEqual([
      "ttl-value",
      2,
      null,
      3600,
      3600,
      "mem-ttl-1",
    ]);
  });

  it("binds null so expires_at stays NULL when no ttl is given", async () => {
    const pool = barePool([
      { match: /SELECT id, version FROM memory\.memories/, rows: [] },
      {
        match: /INSERT INTO memory\.memories/,
        rows: [{ id: "mem-ttl-2", created_at: "2026-08-17" }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-08-17" }],
      },
    ]);
    const store = new PostgresMemoryStore(pool);

    await store.writeMemory({
      key: "ttl-key",
      value: "ttl-value",
      agentId: "agent-ttl",
    });

    const insert = pool.calls.find((c) =>
      /INSERT INTO memory\.memories/.test(c.sql),
    );

    expect(insert?.params).toEqual([
      "agent-ttl",
      "ttl-key",
      "ttl-value",
      null,
      null,
      null,
      null,
    ]);
  });
});
