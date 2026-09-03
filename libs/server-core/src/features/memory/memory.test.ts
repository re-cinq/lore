import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setMemoryPool,
  isMemoryDbAvailable,
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
  agentHealth,
  agentStats,
} from "./memory.js";

interface ScriptedRow {
  match: RegExp;
  rows: any[];
}

function scriptedPool(scripts: ScriptedRow[]) {
  const calls: { sql: string; params: any[] }[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      const hit = scripts.find((s) => s.match.test(sql));

      return { rows: hit ? hit.rows : [] };
    }),
    calls,
  };

  return pool;
}

beforeEach(() => {
  setMemoryPool(null);
});

describe("isMemoryDbAvailable", () => {
  it("false when pool not set", () => {
    setMemoryPool(null);
    expect(isMemoryDbAvailable()).toBe(false);
  });

  it("true after setMemoryPool", () => {
    setMemoryPool(scriptedPool([]));
    expect(isMemoryDbAvailable()).toBe(true);
  });
});

describe("writeMemory", () => {
  it("inserts version 1 for a new key and returns the write result", async () => {
    const pool = scriptedPool([
      { match: /SELECT id, version FROM memory\.memories/, rows: [] },
      {
        match: /INSERT INTO memory\.memories/,
        rows: [{ id: "mem-1", created_at: "2026-06-10" }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-06-10" }],
      },
    ]);

    setMemoryPool(pool);

    const result = await writeMemory({
      key: "auth-pattern",
      value: "use JWT",
      agentId: "agent-7",
    });

    expect(result).toEqual({
      key: "auth-pattern",
      version: 1,
      agent_id: "agent-7",
      created_at: "2026-06-10",
    });
    expect(
      pool.calls.some((c) => /INSERT INTO memory\.memory_versions/.test(c.sql)),
    ).toBe(true);
  });

  it("increments version when the key already exists", async () => {
    const pool = scriptedPool([
      {
        match: /SELECT id, version FROM memory\.memories/,
        rows: [{ id: "mem-1", version: 2 }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-06-10" }],
      },
    ]);

    setMemoryPool(pool);

    const result = await writeMemory({
      key: "auth-pattern",
      value: "use JWT",
      agentId: "agent-7",
    });

    expect(result.version).toBe(3);
    const update = pool.calls.find((c) =>
      /UPDATE memory\.memories/.test(c.sql),
    );

    expect(update?.sql).toMatch(/SET value = \$1, version = \$2/);
  });
});

describe("readMemory", () => {
  it("returns the latest non-deleted version for a key", async () => {
    const pool = scriptedPool([
      {
        match: /SELECT key, value, version, created_at/,
        rows: [
          {
            key: "auth-pattern",
            value: "use JWT",
            version: 3,
            created_at: "2026-06-10",
          },
        ],
      },
    ]);

    setMemoryPool(pool);

    const result = await readMemory("auth-pattern", "agent-7");

    expect(result).toEqual({
      key: "auth-pattern",
      value: "use JWT",
      version: 3,
      created_at: "2026-06-10",
    });
  });

  it('returns all versions newest-first when version is "all"', async () => {
    const pool = scriptedPool([
      {
        match: /FROM memory\.memory_versions mv/,
        rows: [
          { version: 3, value: "use JWT", created_at: "2026-06-10" },
          { version: 2, value: "use sessions", created_at: "2026-06-09" },
        ],
      },
    ]);

    setMemoryPool(pool);

    const result = await readMemory("auth-pattern", "agent-7", "all");

    expect(result).toEqual([
      { version: 3, value: "use JWT", created_at: "2026-06-10" },
      { version: 2, value: "use sessions", created_at: "2026-06-09" },
    ]);
  });

  it("returns null when the key does not exist", async () => {
    const pool = scriptedPool([]);

    setMemoryPool(pool);

    const result = await readMemory("missing", "agent-7");

    expect(result).toBeNull();
  });
});

describe("deleteMemory", () => {
  it("soft-deletes by agent and key, returns deleted true", async () => {
    const pool = scriptedPool([]);

    setMemoryPool(pool);

    const result = await deleteMemory("auth-pattern", "agent-7");

    expect(result).toEqual({ key: "auth-pattern", deleted: true });
    expect(pool.calls[0]).toMatchObject({
      params: ["agent-7", "auth-pattern"],
    });
    expect(pool.calls[0].sql).toMatch(
      /UPDATE memory\.memories SET is_deleted = TRUE/,
    );
  });

  it("writes a delete audit-log entry for the key", async () => {
    const pool = scriptedPool([]);

    setMemoryPool(pool);

    await deleteMemory("stale-key", "agent-7");

    const audit = pool.calls.find((c) => /audit_log/.test(c.sql));

    expect(audit?.params).toEqual(["agent-7", "delete", "stale-key", null]);
  });
});

describe("listMemories", () => {
  it("scopes by repo and returns rows plus total", async () => {
    const pool = scriptedPool([
      {
        match: /FROM memory\.memories m/,
        rows: [{ key: "a", repo: "o/r", version: 1 }],
      },
      { match: /count\(\*\)::int as total/, rows: [{ total: 1 }] },
    ]);

    setMemoryPool(pool);

    const result = await listMemories(undefined, 50, 0, "o/r");

    expect(result).toEqual({
      memories: [{ key: "a", repo: "o/r", version: 1 }],
      total: 1,
    });
    const listCall = pool.calls.find((c) =>
      /FROM memory\.memories m/.test(c.sql),
    );

    expect(listCall?.params).toEqual(["o/r", 50, 0]);
  });

  it("repo filter wins over agent when both supplied", async () => {
    const pool = scriptedPool([
      { match: /count\(\*\)::int as total/, rows: [{ total: 0 }] },
    ]);

    setMemoryPool(pool);

    await listMemories("agent-7", 10, 5, "o/r");

    const listCall = pool.calls.find((c) =>
      /FROM memory\.memories m/.test(c.sql),
    );

    expect(listCall?.params).toEqual(["o/r", 10, 5]);
    expect(listCall?.sql).toMatch(/repo = \$1 AND/);
  });

  it("scopes by agent when no repo, count params hold only the agent", async () => {
    const pool = scriptedPool([
      { match: /count\(\*\)::int as total/, rows: [{ total: 3 }] },
    ]);

    setMemoryPool(pool);

    const result = await listMemories("agent-7", 50, 0);

    expect(result.total).toBe(3);
    const countCall = pool.calls.find((c) =>
      /count\(\*\)::int as total/.test(c.sql),
    );

    expect(countCall?.params).toEqual(["agent-7"]);
  });

  it("org-wide list when no repo and no agent uses empty filter", async () => {
    const pool = scriptedPool([
      { match: /count\(\*\)::int as total/, rows: [{ total: 9 }] },
    ]);

    setMemoryPool(pool);

    await listMemories(undefined, 20, 0);

    const listCall = pool.calls.find((c) =>
      /FROM memory\.memories m/.test(c.sql),
    );

    expect(listCall?.params).toEqual([20, 0]);
    const countCall = pool.calls.find((c) =>
      /count\(\*\)::int as total/.test(c.sql),
    );

    expect(countCall?.params).toEqual([]);
  });
});

describe("agentHealth", () => {
  it("returns memory/snapshot counts keyed to the agent", async () => {
    const pool = scriptedPool([
      {
        match: /memory_count/,
        rows: [
          { memory_count: 4, last_active: "2026-06-10", snapshot_count: 2 },
        ],
      },
    ]);

    setMemoryPool(pool);

    const result = await agentHealth("agent-7");

    expect(result).toEqual({
      agent_id: "agent-7",
      memory_count: 4,
      last_active: "2026-06-10",
      snapshot_count: 2,
    });
  });
});

describe("agentStats", () => {
  it("returns fact/memory/search counters keyed to the agent", async () => {
    const pool = scriptedPool([
      {
        match: /total_memories/,
        rows: [
          {
            total_memories: 12,
            total_facts: 30,
            active_facts: 25,
            invalidated_facts: 5,
            total_searches: 8,
            shared_pools_created: 1,
          },
        ],
      },
    ]);

    setMemoryPool(pool);

    const result = await agentStats("agent-7");

    expect(result).toEqual({
      agent_id: "agent-7",
      total_memories: 12,
      total_facts: 30,
      active_facts: 25,
      invalidated_facts: 5,
      total_searches: 8,
      shared_pools_created: 1,
    });
  });
});

describe("writeMemory transactional write", () => {
  function txPool(versionInsertError?: Error) {
    const clientCalls: { sql: string; params: any[] }[] = [];
    const poolCalls: { sql: string; params: any[] }[] = [];
    const client = {
      query: vi.fn(
        async (sql: string, params: any[] = []): Promise<{ rows: any[] }> => {
          clientCalls.push({ sql, params });

          if (
            versionInsertError &&
            /INSERT INTO memory\.memory_versions/.test(sql)
          ) {
            throw versionInsertError;
          }

          if (/SELECT id, version FROM memory\.memories/.test(sql)) {
            return { rows: [] };
          }

          if (/INSERT INTO memory\.memories/.test(sql)) {
            return { rows: [{ id: "mem-tx-1", created_at: "2026-08-13" }] };
          }

          return { rows: [] };
        },
      ),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(
        async (sql: string, params: any[] = []): Promise<{ rows: any[] }> => {
          poolCalls.push({ sql, params });

          if (/SELECT created_at FROM memory\.memories/.test(sql)) {
            return { rows: [{ created_at: "2026-08-13" }] };
          }

          return { rows: [] };
        },
      ),
      connect: vi.fn(async () => client),
      clientCalls,
      poolCalls,
      client,
    };

    return pool;
  }

  it("commits the memories insert and the version insert in one transaction", async () => {
    const pool = txPool();

    setMemoryPool(pool);

    const result = await writeMemory({
      key: "tx-key",
      value: "tx-value",
      agentId: "agent-tx",
    });

    expect(result).toEqual({
      key: "tx-key",
      version: 1,
      agent_id: "agent-tx",
      created_at: "2026-08-13",
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
    const pool = txPool(
      new Error('relation "memory.memory_versions" does not exist'),
    );

    setMemoryPool(pool);

    await expect(
      writeMemory({ key: "tx-key", value: "tx-value", agentId: "agent-tx" }),
    ).rejects.toThrow('relation "memory.memory_versions" does not exist');

    const sqls = pool.clientCalls.map((c) => c.sql);

    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(pool.client.release).toHaveBeenCalled();
    expect(pool.poolCalls).toEqual([]);
  });

  it("rolls back the version-bump update when the version insert fails", async () => {
    const versionInsertError = new Error(
      'relation "memory.memory_versions" does not exist',
    );
    const clientCalls: { sql: string; params: any[] }[] = [];
    const client = {
      query: vi.fn(
        async (sql: string, params: any[] = []): Promise<{ rows: any[] }> => {
          clientCalls.push({ sql, params });

          if (/INSERT INTO memory\.memory_versions/.test(sql)) {
            throw versionInsertError;
          }

          if (/SELECT id, version FROM memory\.memories/.test(sql)) {
            return { rows: [{ id: "mem-tx-2", version: 3 }] };
          }

          return { rows: [] };
        },
      ),
      release: vi.fn(),
    };
    const poolQuery = vi.fn(async (): Promise<{ rows: any[] }> => ({
      rows: [],
    }));
    const pool = {
      query: poolQuery,
      connect: vi.fn(async () => client),
    };

    setMemoryPool(pool);

    await expect(
      writeMemory({ key: "tx-key", value: "tx-value", agentId: "agent-tx" }),
    ).rejects.toThrow('relation "memory.memory_versions" does not exist');

    const sqls = clientCalls.map((c) => c.sql);

    expect(sqls.some((s) => /UPDATE memory\.memories/.test(s))).toBe(true);
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

import { sharedWrite } from "./memory.js";

describe("sharedWrite transactional write", () => {
  function sharedTxPool(versionInsertError?: Error) {
    const clientCalls: { sql: string; params: unknown[] }[] = [];
    const poolCalls: { sql: string; params: unknown[] }[] = [];

    function clientRows(sql: string): unknown[] {
      if (/INSERT INTO memory\.shared_pools/.test(sql)) {
        return [{ id: "pool-1" }];
      }

      if (/INSERT INTO memory\.memories/.test(sql)) {
        return [{ id: "mem-shared-1", created_at: "2026-08-17" }];
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
          versionInsertError &&
          /INSERT INTO memory\.memory_versions/.test(sql)
        ) {
          throw versionInsertError;
        }

        return { rows: clientRows(sql) as T[] };
      },
      release: vi.fn(),
    };
    const pool = {
      async query<T = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<{ rows: T[] }> {
        poolCalls.push({ sql, params });

        return { rows: [] };
      },
      connect: vi.fn(async () => client),
      clientCalls,
      poolCalls,
      client,
    };

    return pool;
  }

  it("commits the pool create, memories insert, and version insert in one transaction", async () => {
    const pool = sharedTxPool();

    setMemoryPool(pool);

    const result = await sharedWrite("team-pool", {
      key: "shared-key",
      value: "shared-value",
      agentId: "agent-sh",
    });

    expect(result).toEqual({
      key: "shared-key",
      version: 1,
      agent_id: "agent-sh",
      created_at: "2026-08-17",
    });

    const sqls = pool.clientCalls.map((c) => c.sql);

    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.at(-1)).toBe("COMMIT");
    expect(
      sqls.some((s) => /SELECT id FROM memory\.shared_pools/.test(s)),
    ).toBe(true);
    expect(sqls.some((s) => /INSERT INTO memory\.shared_pools/.test(s))).toBe(
      true,
    );
    expect(sqls.some((s) => /INSERT INTO memory\.memories/.test(s))).toBe(true);
    expect(
      sqls.some((s) => /INSERT INTO memory\.memory_versions/.test(s)),
    ).toBe(true);
    expect(pool.poolCalls.map((c) => c.sql)).toEqual([
      expect.stringMatching(/memory\.audit_log/),
    ]);
    expect(pool.client.release).toHaveBeenCalled();
  });

  it("rolls back the pool create and memories insert when the version insert fails", async () => {
    const pool = sharedTxPool(
      new Error('relation "memory.memory_versions" does not exist'),
    );

    setMemoryPool(pool);

    await expect(
      sharedWrite("team-pool", {
        key: "shared-key",
        value: "shared-value",
        agentId: "agent-sh",
      }),
    ).rejects.toThrow('relation "memory.memory_versions" does not exist');

    const sqls = pool.clientCalls.map((c) => c.sql);

    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(pool.poolCalls).toEqual([]);
    expect(pool.client.release).toHaveBeenCalled();
  });

  it("writes sequentially through the bare pool when it has no connect()", async () => {
    const pool = scriptedPool([
      {
        match: /SELECT id FROM memory\.shared_pools/,
        rows: [{ id: "pool-1" }],
      },
      {
        match: /INSERT INTO memory\.memories/,
        rows: [{ id: "mem-shared-1", created_at: "2026-08-17" }],
      },
    ]);

    setMemoryPool(pool);

    const result = await sharedWrite("team-pool", {
      key: "shared-key",
      value: "shared-value",
      agentId: "agent-sh",
    });

    expect(result).toEqual({
      key: "shared-key",
      version: 1,
      agent_id: "agent-sh",
      created_at: "2026-08-17",
    });
    expect(
      pool.calls.some((c) => /INSERT INTO memory\.memory_versions/.test(c.sql)),
    ).toBe(true);
    expect(pool.calls.some((c) => c.sql === "BEGIN")).toBe(false);
  });
});

describe("writeMemory ttl parameterization", () => {
  it("binds ttl 3600 as a make_interval parameter on a fresh insert", async () => {
    const pool = scriptedPool([
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

    setMemoryPool(pool);

    await writeMemory({
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
    const pool = scriptedPool([
      {
        match: /SELECT id, version FROM memory\.memories/,
        rows: [{ id: "mem-ttl-1", version: 1 }],
      },
      {
        match: /SELECT created_at FROM memory\.memories/,
        rows: [{ created_at: "2026-08-17" }],
      },
    ]);

    setMemoryPool(pool);

    await writeMemory({
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
    const pool = scriptedPool([
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

    setMemoryPool(pool);

    await writeMemory({
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
