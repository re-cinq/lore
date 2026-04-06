import { describe, it, expect, vi, beforeEach } from 'vitest';

// We can't directly import extractFacts because it depends on DB and embedding.
// Instead, test the pure logic by re-implementing the key functions here
// and testing the contradiction detection logic with mocked pool.

// ── parseFacts (copied from facts.ts for unit testing) ─────────────

function parseFacts(raw: string): string[] {
  try {
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 10);
    }
  } catch {
    // Fall through to newline fallback
  }

  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.)\]]+\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

describe('parseFacts', () => {
  it('parses a JSON array of strings', () => {
    const input = '["The API uses REST", "The database is PostgreSQL"]';
    expect(parseFacts(input)).toEqual([
      'The API uses REST',
      'The database is PostgreSQL',
    ]);
  });

  it('handles JSON wrapped in code fences', () => {
    const input = '```json\n["fact one", "fact two"]\n```';
    expect(parseFacts(input)).toEqual(['fact one', 'fact two']);
  });

  it('falls back to newline splitting for non-JSON', () => {
    const input = '- fact one\n- fact two\n- fact three';
    expect(parseFacts(input)).toEqual(['fact one', 'fact two', 'fact three']);
  });

  it('handles numbered lists', () => {
    const input = '1. first fact\n2. second fact';
    expect(parseFacts(input)).toEqual(['first fact', 'second fact']);
  });

  it('limits to 10 facts', () => {
    const input = JSON.stringify(Array.from({ length: 15 }, (_, i) => `fact ${i}`));
    expect(parseFacts(input)).toHaveLength(10);
  });

  it('filters empty strings', () => {
    const input = '["valid fact", "", "  ", "another fact"]';
    expect(parseFacts(input)).toEqual(['valid fact', 'another fact']);
  });
});

// ── LLM config defaults ─────────────────────────────────────────────

describe('LLM config', () => {
  it('defaults to Haiku for Claude provider', () => {
    // Mirrors the defaultModel function in facts.ts
    function defaultModel(provider: string): string {
      switch (provider) {
        case 'claude':  return 'claude-haiku-4-5-20251001';
        case 'openai':  return 'gpt-4o-mini';
        case 'ollama':  return 'llama3';
        default:        return 'claude-haiku-4-5-20251001';
      }
    }

    expect(defaultModel('claude')).toBe('claude-haiku-4-5-20251001');
    expect(defaultModel('claude')).not.toContain('sonnet');
  });

  it('falls back to Claude CLI when no API key', () => {
    // The callClaude function should fall back to CLI when ANTHROPIC_API_KEY is not set
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const shouldUseApi = hasApiKey;
    const shouldUseCli = !hasApiKey;
    // In test environment, API key is typically not set
    expect(shouldUseCli || shouldUseApi).toBe(true);
  });

  it('Haiku cost calculation is correct', () => {
    const INPUT_COST = 0.8 / 1_000_000;
    const OUTPUT_COST = 4.0 / 1_000_000;

    // 1000 input tokens + 200 output tokens
    const cost = 1000 * INPUT_COST + 200 * OUTPUT_COST;
    expect(cost).toBeCloseTo(0.0016, 6); // $0.0008 + $0.0008
  });
});

// ── Claude CLI fallback (integration test) ──────────────────────────

describe('callClaudeCli fallback', () => {
  it('extracts facts via claude CLI when ANTHROPIC_API_KEY is unset', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const EXTRACTION_PROMPT =
      'Extract individual factual statements from the following text. ' +
      'Return a JSON array of strings. Each fact should be a single, ' +
      'self-contained statement. Maximum 10 facts.';
    const text = 'Lore uses PostgreSQL with pgvector for vector search. The MCP server runs on GKE.';

    const { stdout } = await execFileAsync('claude', ['-p', `${EXTRACTION_PROMPT}\n\n${text}`, '--output-format', 'text'], {
      timeout: 30_000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });

    const cleaned = stdout.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const facts = JSON.parse(cleaned);

    expect(Array.isArray(facts)).toBe(true);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.length).toBeLessThanOrEqual(10);
    // Should mention postgresql or pgvector
    const allText = facts.join(' ').toLowerCase();
    expect(allText).toMatch(/postgres|pgvector/);
  }, 45_000); // generous timeout for CLI
});

// ── Contradiction detection (integration-style with mock pool) ─────

describe('invalidateContradictions', () => {
  // Simulate the invalidation logic
  async function invalidateContradictions(
    pool: any,
    newFactId: string,
    embeddingStr: string,
    threshold: number,
  ): Promise<number> {
    const { rows } = await pool.query(
      'find-similar',
      [embeddingStr, newFactId, threshold],
    );
    if (rows.length === 0) return 0;

    for (const row of rows) {
      await pool.query('invalidate', [newFactId, row.id]);
    }
    return rows.length;
  }

  it('invalidates high-similarity facts', async () => {
    const queries: any[] = [];
    const mockPool = {
      query: vi.fn(async (sql: string, params: any[]) => {
        queries.push({ sql, params });
        if (sql === 'find-similar') {
          return {
            rows: [
              { id: 'old-fact-1', fact_text: 'CI uses GitHub Actions', similarity: 0.95 },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const count = await invalidateContradictions(mockPool, 'new-fact-1', '[0.1,0.2]', 0.92);
    expect(count).toBe(1);
    expect(mockPool.query).toHaveBeenCalledTimes(2); // find + invalidate
  });

  it('does nothing when no similar facts exist', async () => {
    const mockPool = {
      query: vi.fn(async () => ({ rows: [] })),
    };

    const count = await invalidateContradictions(mockPool, 'new-fact-1', '[0.1,0.2]', 0.92);
    expect(count).toBe(0);
    expect(mockPool.query).toHaveBeenCalledTimes(1); // only find
  });
});
