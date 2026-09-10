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

interface SpecStatusChipsProps {
  counts: Partial<Record<SpecStatus, number>>;
  /** May exceed the status counts' sum: docs with no parsed status are still shown under "All". */
  total: number;
  active: SpecStatusFilter;
  onChange: (filter: SpecStatusFilter) => void;
  kind?: DocKind;
}

export default function SpecStatusChips(props: SpecStatusChipsProps) {
  const { counts, total, active, onChange, kind = "spec" } = props;
  const present = SPEC_STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  if (present.length === 0) {
    return null;
  }

  return (
    <div className={styles.chips}>
      <div className={styles.row}>
        <ChipRow
          chips={[allChip(total), ...present.map((s) => chipFor(s, counts))]}
          onChange={onChange}
          active={active}
        />
      </div>
      <p className={`meta ${styles.legend}`}>{LEGEND[kind]}</p>
    </div>
  );
}

interface StatusChipProps {
  filter: SpecStatusFilter;
  label: string;
  count: number;
  color?: string;
  active: SpecStatusFilter;
  onChange: (filter: SpecStatusFilter) => void;
}

function ChipRow({
  chips,
  onChange,
  active,
}: {
  chips: Pick<StatusChipProps, "filter" | "label" | "count" | "color">[];
  onChange: StatusChipProps["onChange"];
  active: SpecStatusFilter;
}) {
  return chips.map((chip) => (
    <StatusChip
      key={chip.filter}
      {...chip}
      onChange={onChange}
      active={active}
    />
  ));
}

/** One filter chip. `aria-pressed` rather than a selected class, so the current filter is announced and not only coloured. */
function StatusChip(props: StatusChipProps) {
  const { filter, label, count, color, active, onChange } = props;

  return (
    <button
      type="button"
      className={`badge ${styles.chip}`}
      aria-pressed={active === filter}
      onClick={() => onChange(filter)}
    >
      {color && <ChipDot color={color} />}
      {label} ({count})
    </button>
  );
}

/** The status's colour, repeated from the pill so the chip and the doc it filters to read as the same thing. */
function ChipDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className={styles.dot}
      style={{ ["--dot-color" as string]: color }}
    />
  );
}

/** One status's chip data. A status with no docs never reaches here — an "Implemented (0)" chip invites a click that can only produce an empty list. */
function chipFor(
  status: SpecStatus,
  counts: SpecStatusChipsProps["counts"],
): Pick<StatusChipProps, "filter" | "label" | "count" | "color"> {
  return {
    filter: status,
    label: LABEL[status],
    count: counts[status] ?? 0,
    color: SPEC_STATUS_COLOR[status],
  };
}

/** The unfiltered chip. Counted from `total` rather than by summing the statuses, because a doc whose status did not parse is still a doc. */
function allChip(
  total: number,
): Pick<StatusChipProps, "filter" | "label" | "count" | "color"> {
  return { filter: "all", label: "All", count: total };
}
