import { describe, it, expect } from 'vitest';
import { loadTemplates, assembleContext } from '../context-assembly.js';
import { join } from 'node:path';

// ── Token estimation ────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const truncated = text.substring(0, maxChars);
  const lastParagraph = truncated.lastIndexOf('\n\n');
  if (lastParagraph > maxChars * 0.5) {
    return truncated.substring(0, lastParagraph) + '\n\n...(truncated)';
  }
  return truncated + '\n\n...(truncated)';
}

describe('token estimation', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> 3
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('truncateToTokens', () => {
  it('returns text unchanged when under budget', () => {
    const text = 'short text';
    expect(truncateToTokens(text, 100)).toBe(text);
  });

  it('truncates long text at paragraph boundary', () => {
    const paragraph1 = 'First paragraph. '.repeat(20);
    const paragraph2 = 'Second paragraph. '.repeat(20);
    const text = `${paragraph1}\n\n${paragraph2}`;

    const result = truncateToTokens(text, 100); // ~400 chars
    expect(result).toContain('First paragraph');
    expect(result).toContain('...(truncated)');
    expect(result.length).toBeLessThan(text.length);
  });
});

// ── Template loading ────────────────────────────────────────────────

describe('loadTemplates', () => {
  it('loads templates from the templates directory', () => {
    const templateDir = join(import.meta.dirname, '..', '..', 'templates');
    // This should not throw
    loadTemplates(templateDir);
  });
});

// ── assembleContext with mock pool ──────────────────────────────────

describe('assembleContext', () => {
  it('returns empty text when no sources return data', async () => {
    const mockPool = {
      query: async () => ({ rows: [] }),
    };

    const result = await assembleContext(mockPool, 'test query', 'default', 8000);
    expect(result.text).toBe('');
    expect(result.sections).toEqual([]);
  });

  it('assembles context from repo source', async () => {
    const mockPool = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes('org_shared.chunks') && sql.includes('doc')) {
          return { rows: [{ content: 'CLAUDE.md content here' }] };
        }
        return { rows: [] };
      },
    };

    const result = await assembleContext(mockPool, 'test query', 'default', 8000, 'owner/repo');
    expect(result.text).toContain('Conventions');
    expect(result.text).toContain('CLAUDE.md content here');
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it('respects token budget', async () => {
    const longContent = 'x'.repeat(100000); // Way over any budget
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes('org_shared.chunks')) {
          return { rows: [{ content: longContent, file_path: 'test.md' }] };
        }
        return { rows: [] };
      },
    };

    const result = await assembleContext(mockPool, 'test', 'default', 2000, 'owner/repo');
    const totalChars = result.text.length;
    // With 2000 token budget (~8000 chars), result should be under that
    expect(totalChars).toBeLessThan(10000);
    expect(result.sections.some(s => s.truncated)).toBe(true);
  });
});
