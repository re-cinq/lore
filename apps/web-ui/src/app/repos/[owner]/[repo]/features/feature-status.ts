import type { FeatureStatus } from '@/lib/feature-types';

export interface StatusBadge {
  label: string;
  color: string;
}

// Lifecycle status → human label + pill color (mirrors the D3 graph coloring).
const BADGES: Record<FeatureStatus, StatusBadge> = {
  draft: { label: 'Draft', color: '#94a3b8' },
  planning: { label: 'Planning', color: '#f59e0b' },
  'awaiting-input': { label: 'Awaiting input', color: '#f59e0b' },
  'spec-ready': { label: 'Spec ready', color: '#2563eb' },
  'pr-open': { label: 'PR open', color: '#8b5cf6' },
  implemented: { label: 'Implemented', color: '#16a34a' },
  split: { label: 'Split', color: '#d97706' },
};

export function statusBadge(status: FeatureStatus): StatusBadge {
  return BADGES[status] ?? { label: status, color: '#94a3b8' };
}

// Single source for the lifecycle palette. The D3 graph (SpecGraphD3) colors
// Feature nodes through this so node fills and status pills never drift apart.
// Returns undefined for an unknown status so callers can fall back to a default.
export function featureStatusColor(status: string): string | undefined {
  return (BADGES as Record<string, StatusBadge>)[status]?.color;
}

// A feature is mid-planning (the wizard polls) until it is ready to finalize or
// already shipped.
export function isPlanningActive(status: FeatureStatus): boolean {
  return status === 'draft' || status === 'planning' || status === 'awaiting-input' || status === 'spec-ready';
}
