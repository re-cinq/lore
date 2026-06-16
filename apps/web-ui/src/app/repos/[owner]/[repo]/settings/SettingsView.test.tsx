// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsView, { type RepoSettingsShape } from './SettingsView';
import { resolveDarkFactorySettings, DEFAULT_EXECUTION_IMAGE } from '@/lib/dark-factory-resolve';
import { INITIAL_SAVE_STATE, type SaveState } from './SaveResultBanner';
import type { AgentDefinition } from '@/lib/agents-mirror';

const action = vi.fn(async (): Promise<SaveState> => INITIAL_SAVE_STATE);
const agentAction = vi.fn(async () => ({}));

function renderView(settings: RepoSettingsShape = {}, agents: AgentDefinition[] = []) {
  const resolved = resolveDarkFactorySettings(settings.dark_factory ?? null);
  return render(
    <SettingsView
      fullName="re-cinq/lore"
      team="platform"
      settings={settings}
      resolved={resolved}
      defaultExecutionImage={DEFAULT_EXECUTION_IMAGE}
      allRepos={[{ full_name: 're-cinq/a' }, { full_name: 're-cinq/b' }]}
      agents={agents}
      saveAction={action}
      saveAgentAction={agentAction}
      deleteAgentAction={agentAction}
    />,
  );
}

describe('SettingsView', () => {
  it('renders the General section prefilled from settings', () => {
    const { container } = renderView({
      task_types: ['general', 'review'],
      dispatch_default_type: 'general',
      slack_channel_id: 'C123',
      auto_review: true,
      auto_ingest_graph: true,
      trust: { level: 'full' },
    });
    expect((container.querySelector('input[name="team"]') as HTMLInputElement).value).toBe('platform');
    expect((container.querySelector('input[name="task_types"]') as HTMLInputElement).value).toBe('general, review');
    expect((container.querySelector('input[name="dispatch_default_type"]') as HTMLInputElement).value).toBe('general');
    expect(container.querySelector('select[name="auto_review"]')).toHaveValue('yes');
    expect(container.querySelector('select[name="auto_ingest_graph"]')).toHaveValue('yes');
    expect(container.querySelector('select[name="trust_level"]')).toHaveValue('full');
  });

  it('lists every onboarded repo as a cross-repo option', () => {
    const { container } = renderView();
    const opts = container.querySelectorAll('select[name="cross_repo_repos"] option');
    expect(Array.from(opts).map((o) => (o as HTMLOptionElement).value)).toEqual(['re-cinq/a', 're-cinq/b']);
  });

  it('prefills Dark Factory fields from resolved defaults (opt-out posture)', () => {
    const { container } = renderView();
    expect(container.querySelector('select[name="df_enabled"]')).toHaveValue('no');
    expect(container.querySelector('select[name="df_create_issue"]')).toHaveValue('always');
    expect(container.querySelector('select[name="df_review"]')).toHaveValue('always');
    expect(container.querySelector('select[name="df_am_min_trust"]')).toHaveValue('docs');
    expect((container.querySelector('textarea[name="df_am_paths"]') as HTMLTextAreaElement).value)
      .toContain('CLAUDE.md');
  });

  it('prefills the execution image from raw settings, not the default', () => {
    const { container } = renderView({ dark_factory: { execution: { image: 'golang:1.23' } } });
    const input = container.querySelector('input[name="df_execution_image"]') as HTMLInputElement;
    expect(input.value).toBe('golang:1.23');
    expect(input.placeholder).toBe(DEFAULT_EXECUTION_IMAGE);
  });

  it('leaves the execution image empty (placeholder only) when unset', () => {
    const { container } = renderView();
    expect((container.querySelector('input[name="df_execution_image"]') as HTMLInputElement).value).toBe('');
  });

  it('renders an agent card per resolved agent, prefilled, in the Agents tab', () => {
    const { container } = renderView({}, [
      {
        name: 'implementation',
        model: 'claude-opus-4-8',
        timeout_minutes: 45,
        prompt: 'Implement {description}',
        image: 'golang:1.23',
        execution_mode: 'claude-code',
        review_required: true,
        project_id: 'p1',
      },
    ]);
    const sel = container.querySelector('select[name="model_select"]') as HTMLSelectElement;
    expect(sel.value).toBe('claude-opus-4-8');
    expect((container.querySelector('input[name="timeout_minutes"]') as HTMLInputElement).value).toBe('45');
    expect((container.querySelector('input[name="image"]') as HTMLInputElement).value).toBe('golang:1.23');
    expect((container.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('implementation');
  });

  it('shows the empty-state message when there are no incidents', () => {
    renderView();
    expect(screen.getByText(/No recent incidents recorded/)).toBeInTheDocument();
  });

  it('lists incidents with links when present', () => {
    renderView({ incidents: [{ title: 'DB outage', url: 'https://pd/1', created_at: '2026-06-01' }] });
    const link = screen.getByRole('link', { name: 'DB outage' });
    expect(link).toHaveAttribute('href', 'https://pd/1');
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
  });

  it('exposes the approval-PR input for gated changes', () => {
    const { container } = renderView();
    expect(container.querySelector('input[name="approval_pr"]')).toHaveAttribute('placeholder', 're-cinq/lore#123');
  });
});
