import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFeature, refineFeature, finalizeFeature, splitFeature } from './feature-api';

describe('feature-api', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.LORE_API_URL = 'https://lore-api.test';
    process.env.LORE_ADMIN_TOKEN = 'admin-tok';
    delete process.env.LORE_INGEST_TOKEN;
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LORE_API_URL;
    delete process.env.LORE_ADMIN_TOKEN;
    delete process.env.LORE_INGEST_TOKEN;
    vi.restoreAllMocks();
  });

  const mockFetch = (status: number, body: unknown) => {
    global.fetch = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
  };

  it('returns unconfigured when env is missing', async () => {
    delete process.env.LORE_API_URL;
    expect(await createFeature('o/r', 'T', 'P')).toEqual({ status: 'unconfigured' });
  });

  it('falls back to LORE_INGEST_TOKEN when no admin token', async () => {
    delete process.env.LORE_ADMIN_TOKEN;
    process.env.LORE_INGEST_TOKEN = 'ingest-tok';
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 201, json: async () => ({ id: 'f1', task_id: 't1' }) }));
    global.fetch = spy as unknown as typeof fetch;
    await createFeature('o/r', 'T', 'P');
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer ingest-tok');
  });

  it('create posts to /features and returns ok with data', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 201, json: async () => ({ id: 'f1', task_id: 't1' }) }));
    global.fetch = spy as unknown as typeof fetch;
    const result = await createFeature('o/r', 'My feature', 'do it');
    expect(spy.mock.calls[0][0]).toBe('https://lore-api.test/api/repos/o/r/features');
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ title: 'My feature', prompt: 'do it' });
    expect(result).toEqual({ status: 'ok', data: { id: 'f1', task_id: 't1' } });
  });

  it('refine posts user_answers to the iterations path', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 202, json: async () => ({ task_id: 't2', iteration: 2 }) }));
    global.fetch = spy as unknown as typeof fetch;
    await refineFeature('o/r', 'f1', { free_form: 'x' });
    expect(spy.mock.calls[0][0]).toBe('https://lore-api.test/api/repos/o/r/features/f1/iterations');
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ user_answers: { free_form: 'x' } });
  });

  it('finalize posts to the finalize path', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 202, json: async () => ({ task_id: 't3' }) }));
    global.fetch = spy as unknown as typeof fetch;
    await finalizeFeature('o/r', 'f1');
    expect(spy.mock.calls[0][0]).toBe('https://lore-api.test/api/repos/o/r/features/f1/finalize');
  });

  it('split posts title + prompt to the split path', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 201, json: async () => ({ id: 'child' }) }));
    global.fetch = spy as unknown as typeof fetch;
    await splitFeature('o/r', 'parent', 'Part A', 'carve A');
    expect(spy.mock.calls[0][0]).toBe('https://lore-api.test/api/repos/o/r/features/parent/split');
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ title: 'Part A', prompt: 'carve A' });
  });

  it('maps a non-ok response with an error body to an error result', async () => {
    mockFetch(400, { error: 'title and prompt are required' });
    expect(await createFeature('o/r', '', '')).toEqual({ status: 'error', message: 'title and prompt are required' });
  });

  it('falls back to the HTTP status when the error body has no message', async () => {
    mockFetch(500, {});
    expect(await createFeature('o/r', 'T', 'P')).toEqual({ status: 'error', message: 'HTTP 500' });
  });

  it('maps a thrown fetch to an error result', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await createFeature('o/r', 'T', 'P')).toEqual({ status: 'error', message: 'network down' });
  });
});
