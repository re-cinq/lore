// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import DarkFactoryView from './DarkFactoryView';
import { resolveDarkFactorySettings, DEFAULT_EXECUTION_IMAGE } from '@/lib/dark-factory-resolve';
import { INITIAL_SAVE_STATE, type SaveState } from '../../settings/SaveResultBanner';

const action = vi.fn(async (): Promise<SaveState> => INITIAL_SAVE_STATE);

function renderView(
  rawImage?: string,
  df: Parameters<typeof resolveDarkFactorySettings>[0] = null,
  rawBackend?: string,
) {
  return render(
    <DarkFactoryView
      fullName="re-cinq/lore"
      resolved={resolveDarkFactorySettings(df)}
      rawImage={rawImage}
      rawBackend={rawBackend}
      defaultExecutionImage={DEFAULT_EXECUTION_IMAGE}
      saveAction={action}
    />,
  );
}

describe('DarkFactoryView', () => {
  it('prefills the dark-factory fields from resolved defaults (opt-out posture)', () => {
    const { container } = renderView();
    expect(container.querySelector('select[name="df_enabled"]')).toHaveValue('no');
    expect(container.querySelector('select[name="df_create_issue"]')).toHaveValue('always');
    expect(container.querySelector('select[name="df_review"]')).toHaveValue('always');
    expect(container.querySelector('select[name="df_am_min_trust"]')).toHaveValue('docs');
    expect((container.querySelector('textarea[name="df_am_paths"]') as HTMLTextAreaElement).value).toContain('CLAUDE.md');
  });

  it('prefills the execution image from raw settings, with the default as placeholder', () => {
    const { container } = renderView('golang:1.23');
    const input = container.querySelector('input[name="df_execution_image"]') as HTMLInputElement;
    expect(input.value).toBe('golang:1.23');
    expect(input.placeholder).toBe(DEFAULT_EXECUTION_IMAGE);
  });

  it('leaves the execution image empty (placeholder only) when unset', () => {
    const { container } = renderView();
    expect((container.querySelector('input[name="df_execution_image"]') as HTMLInputElement).value).toBe('');
  });

  it('prefills the execution backend select from raw settings', () => {
    const { container } = renderView(undefined, null, 'agent-cr');
    expect(container.querySelector('select[name="df_execution_backend"]')).toHaveValue('agent-cr');
  });

  it('defaults the execution backend to loretask when unset', () => {
    const { container } = renderView();
    expect(container.querySelector('select[name="df_execution_backend"]')).toHaveValue('loretask');
  });

  it('exposes the approval-PR input for gated changes', () => {
    const { container } = renderView();
    expect(container.querySelector('input[name="approval_pr"]')).toHaveAttribute('placeholder', 're-cinq/lore#123');
  });
});
