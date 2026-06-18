/**
 * Pure view-model deriver for the Dark Factory console tab. Folds the resolved
 * settings, the platform cluster gate, the repo's recent tasks, and its
 * dark-factory audit events into a render-ready model (container/presentational,
 * data-down). The key honesty: activation is `active` ONLY when the repo is
 * enabled AND the cluster gate is on — so the console never claims a repo runs
 * dark-mode when the cluster gate would route it to the legacy path.
 */

import type { ResolvedDarkFactorySettings } from '@/lib/dark-factory-resolve';

export interface ConsoleTask {
  id: string;
  task_type: string;
  status: string;
  pr_url: string | null;
  created_at: string;
}

export interface ConsoleAuditEvent {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DarkFactoryConsoleInput {
  resolved: ResolvedDarkFactorySettings;
  clusterGateEnabled: boolean;
  trustLevel: string;
  tasks: ConsoleTask[];
  decisions: ConsoleAuditEvent[];
}

export type ActivationState = 'active' | 'inactive' | 'disabled';

export interface Activation {
  state: ActivationState;
  reason: string;
  repoEnabled: boolean;
  clusterGateEnabled: boolean;
}

export interface WorkItem {
  id: string;
  type: string;
  status: string;
  prUrl: string | null;
  createdAt: string;
}

export interface DecisionItem {
  kind: string;
  summary: string;
  createdAt: string;
}

export interface DarkFactoryConsoleModel {
  activation: Activation;
  config: ResolvedDarkFactorySettings;
  trustLevel: string;
  workItems: WorkItem[];
  decisions: DecisionItem[];
}

function deriveActivation(repoEnabled: boolean, clusterGateEnabled: boolean): Pick<Activation, 'state' | 'reason'> {
  if (!repoEnabled) {
    return { state: 'disabled', reason: 'Repo opted out — dark_factory.enabled is false.' };
  }
  if (!clusterGateEnabled) {
    return {
      state: 'inactive',
      reason: 'Platform cluster gate off — LORE_DARK_FACTORY_CLUSTER_ENABLED is not true, so tasks still run the legacy path.',
    };
  }
  return { state: 'active', reason: 'Repo enabled and platform cluster gate on.' };
}

function summarize(event: ConsoleAuditEvent): string {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case 'auto_merge_decision':
      return `Auto-merge: ${payload.outcome ?? 'unknown'}`;
    case 'escalation_issued':
      return `Escalation: ${payload.reason ?? 'needs-human-help'}`;
    case 'lease_expired':
      return `Lease takeover (prev ${payload.previous_holder ?? 'unknown'})`;
    case 'spec_trace_ingest':
      return `Graph ingest: ${payload.validated_by ?? 0} validated_by, ${payload.violated ?? 0} violated`;
    default:
      return event.event_type;
  }
}

export function deriveDarkFactoryConsole(input: DarkFactoryConsoleInput): DarkFactoryConsoleModel {
  return {
    activation: {
      ...deriveActivation(input.resolved.enabled, input.clusterGateEnabled),
      repoEnabled: input.resolved.enabled,
      clusterGateEnabled: input.clusterGateEnabled,
    },
    config: input.resolved,
    trustLevel: input.trustLevel,
    workItems: input.tasks.map((task) => ({
      id: task.id,
      type: task.task_type,
      status: task.status,
      prUrl: task.pr_url,
      createdAt: task.created_at,
    })),
    decisions: input.decisions.map((event) => ({
      kind: event.event_type,
      summary: summarize(event),
      createdAt: event.created_at,
    })),
  };
}
