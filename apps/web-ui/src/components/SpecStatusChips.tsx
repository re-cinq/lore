"use client";

import {
  SPEC_STATUS_COLOR,
  SPEC_STATUS_ORDER,
  type SpecStatus,
  type SpecStatusFilter,
} from "@/lib/spec-status";

const LABEL: Record<SpecStatus, string> = {
  draft: "Draft",
  "in-progress": "In progress",
  shipped: "Shipped",
  rejected: "Rejected",
};

/** Filter chip row for spec lists: All + one chip per status present, with counts. */
export default function SpecStatusChips({
  counts,
  active,
  onChange,
}: {
  counts: Partial<Record<SpecStatus, number>>;
  active: SpecStatusFilter;
  onChange: (filter: SpecStatusFilter) => void;
}) {
  const present = SPEC_STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  if (present.length === 0) {
    return null;
  }
  const total = present.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  const chip = (
    filter: SpecStatusFilter,
    label: string,
    count: number,
    color?: string,
  ) => (
    <button
      key={filter}
      type="button"
      className="badge"
      aria-pressed={active === filter}
      onClick={() => onChange(filter)}
      style={{
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border:
          active === filter
            ? "1px solid var(--accent)"
            : "1px solid var(--border)",
        background: active === filter ? "var(--info-bg)" : "var(--bg-surface)",
        color: "var(--text)",
      }}
    >
      {color && (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            display: "inline-block",
          }}
        />
      )}
      {label} ({count})
    </button>
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chip("all", "All", total)}
        {present.map((s) =>
          chip(s, LABEL[s], counts[s] ?? 0, SPEC_STATUS_COLOR[s]),
        )}
      </div>
      <p
        className="meta"
        style={{ margin: "6px 0 0", fontSize: "var(--fs-2xs)" }}
      >
        Status (from the spec&apos;s header): Draft = specified, not built · In
        progress / In review = underway · Shipped / Implemented / Complete /
        Accepted = done and live · Rejected / Superseded = abandoned or
        replaced. Coverage = statements validated by linked tests.
      </p>
    </div>
  );
}
