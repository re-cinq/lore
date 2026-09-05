"use client";

import { statusBadge } from "@/lib/feature-status";
import type { FeatureStatus } from "@/lib/feature-types";

export default function StatusBadge({ status }: { status: FeatureStatus }) {
  const badge = statusBadge(status);

  return (
    <span
      role="status"
      aria-label={`Feature status: ${badge.label}`}
      className="status-pill"
      style={{ ["--pill-color" as string]: badge.color }}
    >
      {badge.label}
    </span>
  );
}
