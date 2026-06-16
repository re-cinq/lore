import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listAgents, saveAgent, deleteAgent } from './agents-api';
import type { AgentDefinition } from './agents-mirror';

const realFetch = global.fetch;

const def: AgentDefinition = {
  name: 'general',
  model: 'claude-opus-4-8',
  timeout_minutes: 30,
  prompt: 'Task: {description}',
  image: null,
  execution_mode: 'claude-code',
  review_required: true,
  project_id: 'p1',
};

const mockFetch = (status: number, body: unknown) => {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
};

beforeEach(() => {
  process.env.LORE_API_URL = 'https://lore-api.test';
  process.env.LORE_ADMIN_TOKEN = 'admin-tok';
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.LORE_API_URL;
  delete process.env.LORE_ADMIN_TOKEN;
  vi.restoreAllMocks();
});

describe('listAgents', () => {
  it('returns the agents envelope on 200', async () => {
    mockFetch(200, { agents: [def] });
    expect(await listAgents('o/r')).toEqual([def]);
  });

  it('returns [] when env is missing', async () => {
    delete process.env.LORE_API_URL;
    expect(await listAgents('o/r')).toEqual([]);
  });

  it('falls back to the legacy ingest token when no admin token is set (local dev)', async () => {
    delete process.env.LORE_ADMIN_TOKEN;
    process.env.LORE_INGEST_TOKEN = 'ingest-tok';
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ agents: [def] }) }));
    global.fetch = spy as unknown as typeof fetch;

    expect(await listAgents('o/r')).toEqual([def]);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ingest-tok');

    delete process.env.LORE_INGEST_TOKEN;
  });

  it('returns [] on a non-ok response', async () => {
    mockFetch(500, {});
    expect(await listAgents('o/r')).toEqual([]);
  });

  it('returns [] when fetch throws', async () => {
    global.fetch = vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await listAgents('o/r')).toEqual([]);
  });

  it('returns [] when the envelope has no agents key', async () => {
    mockFetch(200, {});
    expect(await listAgents('o/r')).toEqual([]);
  });
});

describe('saveAgent', () => {
  it('returns unconfigured when env is missing', async () => {
    delete process.env.LORE_ADMIN_TOKEN;
    expect(await saveAgent('o/r', { name: 'general' }, false)).toEqual({ status: 'unconfigured' });
  });

  it('POSTs to the collection on create and returns ok', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ agent: def }) }));
    global.fetch = spy as unknown as typeof fetch;
    const r = await saveAgent('o/r', { name: 'general' }, false);
    expect(r).toEqual({ status: 'ok', agent: def });
    expect(spy.mock.calls[0][0]).toBe('https://lore-api.test/api/repos/o/r/agents');
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('PUTs to the named resource on update with the approval header', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ agent: def }) }));
    global.fetch = spy as unknown as typeof fetch;
    await saveAgent('o/r', { name: 'general', image: 'golang:1.23' }, true, 'o/r#5');
    expect(spy.mock.calls[0][0]).toBe('https://lore-api.test/api/repos/o/r/agents/general');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-lore-approval-pr']).toBe('o/r#5');
  });

  it('maps 403 two_key_required', async () => {
    mockFetch(403, { error: 'two_key_required', detail: 'need PR' });
    expect(await saveAgent('o/r', { name: 'general', image: 'x' }, false))
      .toEqual({ status: 'two_key_required', detail: 'need PR' });
  });

  it('maps 403 codeowners_check_failed', async () => {
    mockFetch(403, { error: 'codeowners_check_failed', code: 'approver_not_codeowner', detail: 'nope' });
    expect(await saveAgent('o/r', { name: 'general', image: 'x' }, false, 'o/r#5'))
      .toEqual({ status: 'codeowners_failed', code: 'approver_not_codeowner', detail: 'nope' });
  });

  it('maps other non-ok responses to an error', async () => {
    mockFetch(400, { error: 'invalid_agent' });
    expect(await saveAgent('o/r', { name: 'general' }, false)).toEqual({ status: 'error', message: 'invalid_agent' });
  });

  it('returns an error when fetch throws', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await saveAgent('o/r', { name: 'general' }, false)).toEqual({ status: 'error', message: 'network' });
  });
});

describe('deleteAgent', () => {
  it('returns unconfigured when env is missing', async () => {
    delete process.env.LORE_API_URL;
    expect(await deleteAgent('o/r', 'general')).toEqual({ status: 'unconfigured' });
  });

  it('returns ok on a 200', async () => {
    mockFetch(200, {});
    expect(await deleteAgent('o/r', 'general')).toEqual({ status: 'ok', agent: { name: 'general' } });
  });

  it('maps a non-ok response to an error', async () => {
    mockFetch(404, { error: 'not found' });
    expect(await deleteAgent('o/r', 'general')).toEqual({ status: 'error', message: 'not found' });
  });

  it('returns an error when fetch throws', async () => {
    global.fetch = vi.fn(async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    expect(await deleteAgent('o/r', 'general')).toEqual({ status: 'error', message: 'boom' });
  });
});
