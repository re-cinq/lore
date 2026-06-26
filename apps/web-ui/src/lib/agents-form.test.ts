import { describe, it, expect } from 'vitest';
import { parseAgentForm, saveResultToState } from './agents-form';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe('parseAgentForm', () => {
  it('reads name_input on create and normalizes the curated model', () => {
    const p = parseAgentForm(fd({ is_new: '1', name_input: 'my-agent', model_select: 'claude-opus-4-8', timeout_minutes: '45' }));
    expect(p).toMatchObject({
      name: 'my-agent',
      isNew: true,
      def: { name: 'my-agent', model: 'claude-opus-4-8', timeout_minutes: 45, execution_mode: 'claude-code', review_required: false },
    });
  });

  it('reads the hidden name on edit and the custom model field', () => {
    const p = parseAgentForm(fd({ is_new: '0', name: 'general', model_select: '__custom__', model_custom: 'my-model' }));
    expect(p.isNew).toBe(false);
    expect(p.name).toBe('general');
    expect(p.def.model).toBe('my-model');
  });

  it('inherits (null) when model/timeout/prompt/image are blank', () => {
    const p = parseAgentForm(fd({ is_new: '0', name: 'general', model_select: '' }));
    expect(p.def).toMatchObject({ model: null, timeout_minutes: null, prompt: null, image: null });
    expect(p.approvalPr).toBeUndefined();
  });

  it('carries the approval PR and preserves execution_mode/review_required', () => {
    const p = parseAgentForm(fd({ is_new: '0', name: 'ingest-tests', execution_mode: 'graph-ingest', review_required: '1', image: 'golang:1.23', approval_pr: 'o/r#5' }));
    expect(p.def.execution_mode).toBe('graph-ingest');
    expect(p.def.review_required).toBe(true);
    expect(p.approvalPr).toBe('o/r#5');
  });
});

describe('saveResultToState', () => {
  it('maps ok to an empty state (page redirects)', () => {
    expect(saveResultToState({ status: 'ok', agent: {} as never })).toEqual({});
  });
  it('maps two_key_required to a twoKey flag', () => {
    expect(saveResultToState({ status: 'two_key_required', detail: 'x' })).toEqual({ twoKey: true });
  });
  it('maps unconfigured + codeowners + error to messages', () => {
    expect(saveResultToState({ status: 'unconfigured' }).error).toMatch(/LORE_API_URL/);
    expect(saveResultToState({ status: 'codeowners_failed', code: 'c', detail: 'nope' }).error).toBe('nope');
    expect(saveResultToState({ status: 'error', message: 'boom' }).error).toBe('boom');
  });
});
