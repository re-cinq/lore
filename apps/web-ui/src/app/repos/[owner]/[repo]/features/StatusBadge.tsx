"use client";

import { statusBadge } from "./feature-status";
import type { FeatureStatus } from "@/lib/feature-types";

export default function StatusBadge({ status }: { status: FeatureStatus }) {
  const badge = statusBadge(status);

  return (
    <span
      role="status"
      aria-label={`Feature status: ${badge.label}`}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--fs-xs)",
        fontWeight: 600,
        color: "var(--text-on-accent)",
        background: badge.color,
      }}
    >
      {badge.label}
    </span>
  );
}
