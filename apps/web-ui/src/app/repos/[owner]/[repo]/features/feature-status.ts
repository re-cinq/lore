import type { FeatureStatus } from "@/lib/feature-types";

export interface StatusBadge {
  label: string;
  color: string;
}

// Lifecycle status → human label + pill color (mirrors the D3 graph coloring).
// Colors are theme tokens so the palette follows the active family × scheme.
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

// Single source for the lifecycle palette. The D3 graph (SpecGraphD3) colors
// Feature nodes through this so node fills and status pills never drift apart.
// Returns undefined for an unknown status so callers can fall back to a default.
export function featureStatusColor(status: string): string | undefined {
  return (BADGES as Record<string, StatusBadge>)[status]?.color;
}

// A feature is mid-planning (the wizard polls) until it is ready to finalize or
// already shipped.
export function isPlanningActive(status: FeatureStatus): boolean {
  return (
    status === "draft" ||
    status === "planning" ||
    status === "awaiting-input" ||
    status === "spec-ready"
  );
}
