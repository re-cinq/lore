import type { FeatureStatus } from "@/lib/feature-types";

export interface StatusBadge {
  label: string;
  color: string;
}

// Lifecycle status → label + color (mirrors D3 coloring); theme tokens follow active family × scheme.
const BADGES: Record<FeatureStatus, StatusBadge> = {
  draft: { label: "Draft", color: "var(--chart-neutral)" },
  planning: { label: "Planning", color: "var(--warning)" },
  "awaiting-input": { label: "Awaiting input", color: "var(--warning)" },
  "spec-ready": { label: "Spec ready", color: "var(--chart-statement)" },
  "pr-open": { label: "PR open", color: "var(--chart-spec)" },
  implemented: { label: "Implemented", color: "var(--chart-test)" },
};

export function statusBadge(status: FeatureStatus): StatusBadge {
  return BADGES[status] ?? { label: status, color: "var(--chart-neutral)" };
}

// Single source for lifecycle palette; D3 colors Feature nodes so fills and pills don't drift.
export function featureStatusColor(status: string): string | undefined {
  return (BADGES as Record<string, StatusBadge>)[status]?.color;
}

// Feature is mid-planning (wizard polls) until ready to finalize or shipped.
export function isPlanningActive(status: FeatureStatus): boolean {
  return (
    status === "draft" ||
    status === "planning" ||
    status === "awaiting-input" ||
    status === "spec-ready"
  );
}

// Lifecycle is moving until shipped; wider than `isPlanningActive` to include spec PR open (WAITING STATE on line).
export function isLifecycleActive(status: FeatureStatus): boolean {
  return isPlanningActive(status) || status === "pr-open";
}
