// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DarkFactoryConsoleView from './DarkFactoryConsoleView';
import { deriveDarkFactoryConsole } from './derive-console';
import { resolveDarkFactorySettings } from '@/lib/dark-factory-resolve';

const model = (over: Partial<Parameters<typeof deriveDarkFactoryConsole>[0]> = {}) =>
  deriveDarkFactoryConsole({
    resolved: resolveDarkFactorySettings({ enabled: true }),
    clusterGateEnabled: true,
    trustLevel: 'implementation',
    tasks: [],
    decisions: [],
    ...over,
  });

describe('DarkFactoryConsoleView', () => {
  it('shows the Active badge when the repo is enabled and the cluster gate is on', () => {
    render(<DarkFactoryConsoleView owner="re-cinq" repo="lore" model={model()} />);
    expect(screen.getByText(/^active$/i)).toBeTruthy();
  });

  it('surfaces the cluster-gate reason when enabled but the cluster gate is off', () => {
    render(<DarkFactoryConsoleView owner="re-cinq" repo="lore" model={model({ clusterGateEnabled: false })} />);
    expect(screen.getByText(/^inactive$/i)).toBeTruthy();
    expect(screen.getByText(/cluster gate/i)).toBeTruthy();
  });

  it('renders work items and the decision feed', () => {
    render(
      <DarkFactoryConsoleView
        owner="re-cinq"
        repo="lore"
        model={model({
          tasks: [{ id: 't1', task_type: 'runbook', status: 'completed', pr_url: 'https://gh/pr/1', created_at: '2026-06-11T10:00:00Z' }],
          decisions: [{ event_type: 'auto_merge_decision', payload: { outcome: 'merged' }, created_at: '2026-06-11T11:00:00Z' }],
        })}
      />,
    );
    expect(screen.getByText('runbook')).toBeTruthy();
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('Auto-merge: merged')).toBeTruthy();
  });
});
