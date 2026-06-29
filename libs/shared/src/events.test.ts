import { describe, it, expect } from 'vitest';
import { eventRepo, insertEvent } from './events.js';

describe('eventRepo', () => {
  it('returns the repo string when params carries one', () => {
    expect(eventRepo({ repo: 're-cinq/lore', pr_number: 7 })).toEqual('re-cinq/lore');
  });

  it('returns null when params has no repo (cron / kubernetes events)', () => {
    expect(eventRepo({ taskId: 'abc' })).toBeNull();
    expect(eventRepo(undefined)).toBeNull();
  });

  it('returns null when repo is present but not a string', () => {
    expect(eventRepo({ repo: 123 })).toBeNull();
  });
});

describe('insertEvent', () => {
  it('writes the derived repo into the repo column', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = { query: async (sql: string, params: unknown[]) => void calls.push({ sql, params }) };

    await insertEvent(pool, {
      eventName: 'github.pull_request.opened',
      source: 'github',
      params: { repo: 're-cinq/lore', pr_number: 7 },
    });

    expect(calls[0]?.sql).toContain('repo');
    expect(calls[0]?.params).toContain('re-cinq/lore');
  });
});
