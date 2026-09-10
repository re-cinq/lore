// Mirrors libs/shared/src/domain/spec-status.ts parsers (parity guarded by spec-status.parity.test.ts + type-drift #1419).

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
  // Shipped-then-terminated (distinct from rejected); both skip require-statement-links.
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

    return statusInfoFromCell(cells[2]);
  }

  return null;
}

/** Bucket + label from the `| Status |` row's value cell, trailing qualifier stripped. */
function statusInfoFromCell(statusCell: string): SpecStatusInfo | null {
  const value = statusCell.replace(/\*/g, "").trim();
  const bucket = BUCKETS.find((b) => b.re.test(value.toLowerCase()));

  if (!bucket) {
    return null;
  }
  const [beforeDash] = value.split(/\s+[—–-]\s+/);
  const [beforeParen] = beforeDash.split(" (");
  const label = beforeParen.trim();

  return {
    status: bucket.status,
    label: label.slice(0, MAX_LABEL) || value.slice(0, MAX_LABEL),
  };
}

/** Bucket a bare status value (an ADR frontmatter `status:`) into pill status. */
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
  status: SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
): boolean {
  return filter === "all" || status?.status === filter;
}
