// Mirrors libs/shared/src/spec-status.ts parsers (parity guarded by spec-status.parity.test.ts + type-drift #1419).

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
