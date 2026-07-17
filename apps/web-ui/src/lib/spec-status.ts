// Parses a doc's lifecycle status into a normalized bucket + display label.
// Two source shapes feed the same buckets (in-sync mirror of the canonical
// parser in libs/shared/src/spec-status.ts — web-ui cannot import lore-shared):
//   - spec.md — the `| Status | ... |` header table row
//   - ADR .md — YAML frontmatter `status: <value>`
// Pure value-in/value-out — the markdown comes from the trace-graph source.

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

function adrFrontmatterStatusValue(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatter) {
    return null;
  }

  for (const line of frontmatter[1].split(/\r?\n/)) {
    const keyValue = line.match(/^status\s*:\s*(.+?)\s*$/i);

    if (keyValue) {
      return keyValue[1].replace(/["']/g, "").trim();
    }
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

export function parseDocStatus(
  markdown: string,
  kind: DocKind,
): SpecStatusInfo | null {
  if (kind === "spec") {
    return parseSpecStatus(markdown);
  }
  const value = adrFrontmatterStatusValue(markdown);

  return value === null ? null : statusInfoFromValue(value);
}

export type SpecStatusFilter = "all" | SpecStatus;

export function matchesSpecStatusFilter(
  info: SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
): boolean {
  return filter === "all" || info?.status === filter;
}
