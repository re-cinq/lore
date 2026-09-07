"use client";

import styles from "./SpecStatusChips.module.scss";
import {
  SPEC_STATUS_COLOR,
  SPEC_STATUS_ORDER,
  type DocKind,
  type SpecStatus,
  type SpecStatusFilter,
} from "@/lib/spec-status";

const LABEL: Record<SpecStatus, string> = {
  draft: "Draft",
  "in-progress": "In progress",
  shipped: "Shipped",
  rejected: "Rejected",
  retired: "Retired",
};

const LEGEND: Record<DocKind, string> = {
  spec:
    "Status (from the spec's header): Draft = specified, not built · In " +
    "progress / In review = underway · Shipped / Implemented / Complete / " +
    "Accepted = done and live · Rejected / Superseded = abandoned or " +
    "replaced. Coverage = statements validated by linked tests.",
  adr:
    "Status (from the ADR's frontmatter): Draft = decision being written · " +
    "Proposed / In progress = under discussion · Accepted / Shipped = " +
    "decided and live · Rejected / Superseded = abandoned or replaced.",
};

/** `total` can exceed the status counts' sum, since docs with no parsed status are still shown under "All". */
/** One filter chip. `aria-pressed` rather than a selected class, so the current filter is announced and not only coloured. */
function StatusChip({
  filter,
  label,
  count,
  color,
  active,
  onChange,
}: {
  filter: SpecStatusFilter;
  label: string;
  count: number;
  color?: string;
  active: SpecStatusFilter;
  onChange: (filter: SpecStatusFilter) => void;
}) {
  return (
    <button
      type="button"
      className={`badge ${styles.chip}`}
      aria-pressed={active === filter}
      onClick={() => onChange(filter)}
    >
      {color && (
        <span
          aria-hidden
          className={styles.dot}
          style={{ ["--dot-color" as string]: color }}
        />
      )}
      {label} ({count})
    </button>
  );
}

export default function SpecStatusChips({
  counts,
  total,
  active,
  onChange,
  kind = "spec",
}: {
  counts: Partial<Record<SpecStatus, number>>;
  total: number;
  active: SpecStatusFilter;
  onChange: (filter: SpecStatusFilter) => void;
  kind?: DocKind;
}) {
  const present = SPEC_STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  if (present.length === 0) {
    return null;
  }

  return (
    <div className={styles.chips}>
      <div className={styles.row}>
        <StatusChip
          filter="all"
          label="All"
          count={total}
          onChange={onChange}
          active={active}
        />
        {present.map((s) => (
          <StatusChip
            key={s}
            filter={s}
            label={LABEL[s]}
            count={counts[s] ?? 0}
            color={SPEC_STATUS_COLOR[s]}
            onChange={onChange}
            active={active}
          />
        ))}
      </div>
      <p className={`meta ${styles.legend}`}>{LEGEND[kind]}</p>
    </div>
  );
}
