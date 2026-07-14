// Parses the `| Status | ... |` header row of a spec.md into a normalized
// lifecycle bucket + display label. Pure value-in/value-out — the markdown may
// come from the trace-graph source (detail pages) or Postgres chunks (lists).

export type SpecStatus = "draft" | "in-progress" | "shipped" | "rejected";

export interface SpecStatusInfo {
  status: SpecStatus;
  label: string;
}

export const SPEC_STATUS_COLOR: Record<SpecStatus, string> = {
  draft: "var(--chart-neutral)",
  "in-progress": "var(--warning)",
  shipped: "var(--success)",
  rejected: "var(--danger)",
};

export const SPEC_STATUS_ORDER: SpecStatus[] = [
  "draft",
  "in-progress",
  "shipped",
  "rejected",
];

const BUCKETS: Array<{ status: SpecStatus; re: RegExp }> = [
  { status: "draft", re: /^draft/ },
  { status: "in-progress", re: /^(in progress|in review|planning|wip)/ },
  {
    status: "shipped",
    re: /^(shipped|implemented|complete|accepted|done|live)/,
  },
  { status: "rejected", re: /^(rejected|superseded|abandoned|obsolete|deprecated)/ },
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
    const label = value.split(/\s+[—–-]\s+/)[0].split(" (")[0].trim();

    return {
      status: bucket.status,
      label: label.slice(0, MAX_LABEL) || value.slice(0, MAX_LABEL),
    };
  }

  return null;
}

export type SpecStatusFilter = "all" | SpecStatus;

export function matchesSpecStatusFilter(
  info: SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
): boolean {
  return filter === "all" || info?.status === filter;
}
