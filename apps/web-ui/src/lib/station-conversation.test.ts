import { describe, it, expect } from 'vitest';
import { formatStationConversation } from './station-conversation';

describe('formatStationConversation', () => {
  it('keeps runner markers and renders thinking, tool use, results and text', () => {
    const raw = [
      '[runner] Reusing cached repo at /workspace/repo (fetch)',
      '[supervisor] Walking workflow feature-planning',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Let me analyze the request and write result.json' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'jq empty result.json' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'VALID JSON' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'result.json is written.' }] } }),
      JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 42 }),
    ].join('\n');

    const out = formatStationConversation(raw);
    expect(out).toContain('[runner] Reusing cached repo at /workspace/repo (fetch)');
    expect(out).toContain('[supervisor] Walking workflow feature-planning');
    expect(out).toContain('thinking: Let me analyze the request and write result.json');
    expect(out).toContain('→ Bash: jq empty result.json');
    expect(out).toContain('← VALID JSON');
    expect(out).toContain('result.json is written.');
    expect(out).not.toContain('thinking_tokens');
  });

  it('summarizes a Write tool_use by its file_path', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/workspace/repo/result.json', content: '{}' } }] },
    });
    expect(formatStationConversation(raw)).toBe('→ Write: /workspace/repo/result.json');
  });

  it('returns only the last maxEvents lines and skips unparseable JSON', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `[runner] line ${i}`);
    lines.push('{ not valid json');
    const out = formatStationConversation(lines.join('\n'), 5);
    expect(out.split('\n')).toHaveLength(5);
    expect(out).toContain('[runner] line 39');
    expect(out).not.toContain('[runner] line 34');
    expect(out).not.toContain('not valid json');
  });
});
