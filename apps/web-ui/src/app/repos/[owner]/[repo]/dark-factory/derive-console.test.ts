import { describe, it, expect } from 'vitest';
import { deriveDarkFactoryConsole } from './derive-console';
import { resolveDarkFactorySettings } from '@/lib/dark-factory-resolve';

const resolvedEnabled = resolveDarkFactorySettings({ enabled: true });
const resolvedDisabled = resolveDarkFactorySettings({ enabled: false });

const baseInput = {
  resolved: resolvedEnabled,
  clusterGateEnabled: true,
  trustLevel: 'implementation',
  tasks: [],
  decisions: [],
};

describe('deriveDarkFactoryConsole activation', () => {
  it('is active when the repo is enabled and the cluster gate is on', () => {
    expect(deriveDarkFactoryConsole({ ...baseInput }).activation.state).toBe('active');
  });

  it('is inactive with a cluster-gate reason when the repo is enabled but the cluster gate is off', () => {
    const model = deriveDarkFactoryConsole({ ...baseInput, clusterGateEnabled: false });
    expect(model.activation.state).toBe('inactive');
    expect(model.activation.reason).toMatch(/cluster gate/i);
  });

  it('is disabled when the repo is not enabled, regardless of the cluster gate', () => {
    const model = deriveDarkFactoryConsole({ ...baseInput, resolved: resolvedDisabled, clusterGateEnabled: true });
    expect(model.activation.state).toBe('disabled');
  });
});

describe('deriveDarkFactoryConsole projections', () => {
  it('exposes the resolved config and trust level', () => {
    const model = deriveDarkFactoryConsole({ ...baseInput });
    expect(model.config).toBe(resolvedEnabled);
    expect(model.trustLevel).toBe('implementation');
  });

  it('projects recent tasks to work items with id, type, status, and PR link', () => {
    const model = deriveDarkFactoryConsole({
      ...baseInput,
      tasks: [{ id: 't1', task_type: 'implementation', status: 'completed', pr_url: 'https://gh/pr/1', created_at: '2026-06-11T10:00:00Z' }],
    });
    expect(model.workItems[0]).toEqual({
      id: 't1',
      type: 'implementation',
      status: 'completed',
      prUrl: 'https://gh/pr/1',
      createdAt: '2026-06-11T10:00:00Z',
    });
  });

  it('projects audit events to a decision feed summarized by kind', () => {
    const model = deriveDarkFactoryConsole({
      ...baseInput,
      decisions: [
        { event_type: 'auto_merge_decision', payload: { outcome: 'merged' }, created_at: '2026-06-11T11:00:00Z' },
        { event_type: 'escalation_issued', payload: { reason: 'validation failed' }, created_at: '2026-06-11T10:00:00Z' },
        { event_type: 'lease_expired', payload: { previous_holder: 'pod-xyz' }, created_at: '2026-06-11T09:00:00Z' },
        { event_type: 'spec_trace_ingest', payload: { validated_by: 102, violated: 3 }, created_at: '2026-06-11T08:00:00Z' },
      ],
    });
    expect(model.decisions.map((d) => d.summary)).toEqual([
      'Auto-merge: merged',
      'Escalation: validation failed',
      'Lease takeover (prev pod-xyz)',
      'Graph ingest: 102 validated_by, 3 violated',
    ]);
  });
});
