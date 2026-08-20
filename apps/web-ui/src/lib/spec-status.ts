// Lifecycle status types + the parsers the DETAIL pages still need locally
// (web-ui cannot import lore-shared). List pages no longer parse anything: the
// API now returns each doc's {status,label} with the list itself, via
// `docStatusPill` in libs/shared/src/spec-status.ts — the canonical parser this
// file mirrors.
//   - parseSpecStatus  — spec.md `| Status | ... |` header row (spec detail)
//   - statusInfoFromValue — a bare ADR frontmatter value (ADR detail)
//
// Intentional split, not full duplication: canonical also carries the
// require-statement-links lint tiers and the status rewriters, which web-ui
// never needs; this side adds the pill colors/order/filter UI helpers. The
// parse core is held in lockstep by `spec-status.parity.test.ts` (buckets +
// labels vs `docStatusPill`) and scripts/type-drift/spec-status.drift.ts
// (the SpecStatus ↔ StatusBucket union, `npm run typecheck:drift`).
//
// DECISION (#1419): not a type mirror at all — this side mirrors PARSERS, and no
// generated type replaces a function. The parity test is the right guard and it
// stays.

export type DocKind = "spec" | "adr";

export type SpecStatus =
  "draft" | "in-progress" | "shipped" | "rejected" | "retired";

export interface SpecStatusInfo {
  status: SpecStatus;
  label: string;
}

export const SPEC_STATUS_COLOR: Record<SpecStatus, string> = {
  draft: "var(--chart-neutral)",
  "in-progress": "var(--warning)",
  shipped: "var(--success)",
  rejected: "var(--danger)",
  retired: "var(--chart-neutral)",
};

export const SPEC_STATUS_ORDER: SpecStatus[] = [
  "draft",
  "in-progress",
  "shipped",
  "rejected",
  "retired",
];

const BUCKETS: Array<{ status: SpecStatus; re: RegExp }> = [
  { status: "draft", re: /^draft/ },
  {
    status: "in-progress",
    re: /^(in progress|in review|planning|wip|proposed)/,
  },
  {
    status: "shipped",
    re: /^(shipped|implemented|complete|accepted|done|live)/,
  },
  // Shipped-then-terminated — distinct from rejected (never accepted); both skip
  // the require-statement-links rule. Mirrors libs/shared/src/spec-status.ts.
  {
    status: "retired",
    re: /^(retired|superseded|removed|deprecated|obsolete)/,
  },
  {
    status: "rejected",
    re: /^(rejected|abandoned)/,
  },
];

const MAX_LABEL = 24;

export function parseSpecStatus(markdown: string): SpecStatusInfo | null {
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());

    if (cells.length < 3 || cells[1].toLowerCase() !== "status") {
      continue;
    }
    const value = cells[2].replace(/\*/g, "").trim();
    const bucket = BUCKETS.find((b) => b.re.test(value.toLowerCase()));

    if (!bucket) {
      return null;
    }
    const label = value
      .split(/\s+[—–-]\s+/)[0]
      .split(" (")[0]
      .trim();

    return {
      status: bucket.status,
      label: label.slice(0, MAX_LABEL) || value.slice(0, MAX_LABEL),
    };
  }

  return null;
}

/** Bucket a bare status value (an ADR frontmatter `status:`) into pill info. */
export function statusInfoFromValue(value: string): SpecStatusInfo | null {
  const bucket = BUCKETS.find((b) => b.re.test(value.toLowerCase()));

  if (!bucket) {
    return null;
  }

  return {
    status: bucket.status,
    label: (value.charAt(0).toUpperCase() + value.slice(1)).slice(0, MAX_LABEL),
  };
}

export type SpecStatusFilter = "all" | SpecStatus;

export function matchesSpecStatusFilter(
  info: SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
): boolean {
  return filter === "all" || info?.status === filter;
}
