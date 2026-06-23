import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setMemoryPool,
  isMemoryDbAvailable,
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
  agentHealth,
  agentStats,
} from './memory.js';

// These handlers run their queries against the module-level pool set via
// setMemoryPool. A scripted mock pool returns rows by matching the SQL text,
// so each test asserts on the exact params the handler builds and the shape
// it returns — no live Postgres needed.

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

describe('isMemoryDbAvailable', () => {
  it('false when pool not set', () => {
    setMemoryPool(null);
    expect(isMemoryDbAvailable()).toBe(false);
  });

  it('true after setMemoryPool', () => {
    setMemoryPool(scriptedPool([]));
    expect(isMemoryDbAvailable()).toBe(true);
  });
});

describe('writeMemory', () => {
  it('inserts version 1 for a new key and returns the write result', async () => {
    const pool = scriptedPool([
      // existing-row lookup: none
      { match: /SELECT id, version FROM memory\.memories/, rows: [] },
      { match: /INSERT INTO memory\.memories/, rows: [{ id: 'mem-1', created_at: '2026-06-10' }] },
      { match: /SELECT created_at FROM memory\.memories/, rows: [{ created_at: '2026-06-10' }] },
    ]);
    setMemoryPool(pool);

    const result = await writeMemory('auth-pattern', 'use JWT', 'agent-7');

    expect(result).toEqual({
      key: 'auth-pattern',
      version: 1,
      agent_id: 'agent-7',
      created_at: '2026-06-10',
    });
    expect(pool.calls.some((c) => /INSERT INTO memory\.memory_versions/.test(c.sql))).toBe(true);
  });

  it('increments version when the key already exists', async () => {
    const pool = scriptedPool([
      { match: /SELECT id, version FROM memory\.memories/, rows: [{ id: 'mem-1', version: 2 }] },
      { match: /SELECT created_at FROM memory\.memories/, rows: [{ created_at: '2026-06-10' }] },
    ]);
    setMemoryPool(pool);

    const result = await writeMemory('auth-pattern', 'use JWT', 'agent-7');

    expect(result.version).toBe(3);
    const update = pool.calls.find((c) => /UPDATE memory\.memories/.test(c.sql));
    expect(update?.sql).toMatch(/SET value = \$1, version = \$2/);
  });
});

describe('readMemory', () => {
  it('returns the latest non-deleted version for a key', async () => {
    const pool = scriptedPool([
      {
        match: /SELECT key, value, version, created_at/,
        rows: [{ key: 'auth-pattern', value: 'use JWT', version: 3, created_at: '2026-06-10' }],
      },
    ]);
    setMemoryPool(pool);

    const result = await readMemory('auth-pattern', 'agent-7');

    expect(result).toEqual({
      key: 'auth-pattern',
      value: 'use JWT',
      version: 3,
      created_at: '2026-06-10',
    });
  });

  it('returns all versions newest-first when version is "all"', async () => {
    const pool = scriptedPool([
      {
        match: /FROM memory\.memory_versions mv/,
        rows: [
          { version: 3, value: 'use JWT', created_at: '2026-06-10' },
          { version: 2, value: 'use sessions', created_at: '2026-06-09' },
        ],
      },
    ]);
    setMemoryPool(pool);

    const result = await readMemory('auth-pattern', 'agent-7', 'all');

    expect(result).toEqual([
      { version: 3, value: 'use JWT', created_at: '2026-06-10' },
      { version: 2, value: 'use sessions', created_at: '2026-06-09' },
    ]);
  });

  it('returns null when the key does not exist', async () => {
    const pool = scriptedPool([]);
    setMemoryPool(pool);

    const result = await readMemory('missing', 'agent-7');

    expect(result).toBeNull();
  });
});

describe('deleteMemory', () => {
  it('soft-deletes by agent and key, returns deleted true', async () => {
    const pool = scriptedPool([]);
    setMemoryPool(pool);

    const result = await deleteMemory('auth-pattern', 'agent-7');

    expect(result).toEqual({ key: 'auth-pattern', deleted: true });
    expect(pool.calls[0]).toMatchObject({
      params: ['agent-7', 'auth-pattern'],
    });
    expect(pool.calls[0].sql).toMatch(/UPDATE memory\.memories SET is_deleted = TRUE/);
  });

  it('writes a delete audit-log entry for the key', async () => {
    const pool = scriptedPool([]);
    setMemoryPool(pool);

    await deleteMemory('stale-key', 'agent-7');

    const audit = pool.calls.find((c) => /audit_log/.test(c.sql));
    expect(audit?.params).toEqual(['agent-7', 'delete', 'stale-key', null]);
  });
});

describe('listMemories', () => {
  it('scopes by repo and returns rows plus total', async () => {
    const pool = scriptedPool([
      { match: /FROM memory\.memories m/, rows: [{ key: 'a', repo: 'o/r', version: 1 }] },
      { match: /count\(\*\)::int as total/, rows: [{ total: 1 }] },
    ]);
    setMemoryPool(pool);

    const result = await listMemories(undefined, 50, 0, 'o/r');

    expect(result).toEqual({
      memories: [{ key: 'a', repo: 'o/r', version: 1 }],
      total: 1,
    });
    const listCall = pool.calls.find((c) => /FROM memory\.memories m/.test(c.sql));
    expect(listCall?.params).toEqual(['o/r', 50, 0]);
  });

  it('repo filter wins over agent when both supplied', async () => {
    const pool = scriptedPool([{ match: /count\(\*\)::int as total/, rows: [{ total: 0 }] }]);
    setMemoryPool(pool);

    await listMemories('agent-7', 10, 5, 'o/r');

    const listCall = pool.calls.find((c) => /FROM memory\.memories m/.test(c.sql));
    expect(listCall?.params).toEqual(['o/r', 10, 5]);
    expect(listCall?.sql).toMatch(/repo = \$1 AND/);
  });

  it('scopes by agent when no repo, count params hold only the agent', async () => {
    const pool = scriptedPool([{ match: /count\(\*\)::int as total/, rows: [{ total: 3 }] }]);
    setMemoryPool(pool);

    const result = await listMemories('agent-7', 50, 0);

    expect(result.total).toBe(3);
    const countCall = pool.calls.find((c) => /count\(\*\)::int as total/.test(c.sql));
    expect(countCall?.params).toEqual(['agent-7']);
  });

  it('org-wide list when no repo and no agent uses empty filter', async () => {
    const pool = scriptedPool([{ match: /count\(\*\)::int as total/, rows: [{ total: 9 }] }]);
    setMemoryPool(pool);

    await listMemories(undefined, 20, 0);

    const listCall = pool.calls.find((c) => /FROM memory\.memories m/.test(c.sql));
    expect(listCall?.params).toEqual([20, 0]);
    const countCall = pool.calls.find((c) => /count\(\*\)::int as total/.test(c.sql));
    expect(countCall?.params).toEqual([]);
  });
});

describe('agentHealth', () => {
  it('returns memory/snapshot counts keyed to the agent', async () => {
    const pool = scriptedPool([
      {
        match: /memory_count/,
        rows: [{ memory_count: 4, last_active: '2026-06-10', snapshot_count: 2 }],
      },
    ]);
    setMemoryPool(pool);

    const result = await agentHealth('agent-7');

    expect(result).toEqual({
      agent_id: 'agent-7',
      memory_count: 4,
      last_active: '2026-06-10',
      snapshot_count: 2,
    });
  });
});

describe('agentStats', () => {
  it('returns fact/memory/search counters keyed to the agent', async () => {
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

    const result = await agentStats('agent-7');

    expect(result).toEqual({
      agent_id: 'agent-7',
      total_memories: 12,
      total_facts: 30,
      active_facts: 25,
      invalidated_facts: 5,
      total_searches: 8,
      shared_pools_created: 1,
    });
  });
});
