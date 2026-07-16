// Parses a doc's lifecycle status into a normalized bucket. Two source shapes
// feed the same buckets (in-sync mirror of the canonical parser in
// libs/shared/src/spec-status.ts — web-ui cannot import lore-shared):
//   - spec.md — the `| Status | ... |` header table row
//   - ADR .md — YAML frontmatter `status: <value>`
// Pure value-in/value-out — the markdown comes from the trace-graph source.
//
// The bucket is the ONLY thing that escapes this module (ADR-037). The synonym
// table below is tolerant on the way in, because Lore parses corpora it does not
// own — a repo onboarded with MADR ADRs writes `status: accepted`, and Lore's own
// onboard prompt tells it to. Emitting the author's raw word back out is what
// made one state render as four different pills, across two corpora that spell
// the same state differently (`Implemented` vs `accepted`).

export type DocKind = "spec" | "adr";

export type SpecStatus =
  "draft" | "in-progress" | "shipped" | "rejected" | "retired";

/** The one display name per bucket — every surface renders these, never the
 *  raw cell or frontmatter text. Purely a UI concern: the write-side vocabulary
 *  (what a status flip puts *into* a file, per corpus) is shared's
 *  `statusLabel(status, kind)`, which is a different table on purpose. */
export const SPEC_STATUS_LABEL: Record<SpecStatus, string> = {
  draft: "Draft",
  "in-progress": "In progress",
  shipped: "Shipped",
  rejected: "Rejected",
  retired: "Retired",
};

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

// Mirrors libs/shared/src/spec-status.ts — the canonical vocabulary (ADR-037).
// spec-status.parity.test.ts holds the two in lockstep; edit both together.
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

/** Bucket a bare status value — an ADR frontmatter `status:`, or a spec's
 *  status cell once the table markup is stripped. */
export function statusFromValue(value: string): SpecStatus | null {
  return BUCKETS.find((b) => b.re.test(value.toLowerCase()))?.status ?? null;
}

export function parseSpecStatus(markdown: string): SpecStatus | null {
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());

    if (cells.length < 3 || cells[1].toLowerCase() !== "status") {
      continue;
    }

    return statusFromValue(cells[2].replace(/\*/g, "").trim());
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

export function parseDocStatus(
  markdown: string,
  kind: DocKind,
): SpecStatus | null {
  if (kind === "spec") {
    return parseSpecStatus(markdown);
  }
  const value = adrFrontmatterStatusValue(markdown);

  return value === null ? null : statusFromValue(value);
}

export type SpecStatusFilter = "all" | SpecStatus;

export function matchesSpecStatusFilter(
  status: SpecStatus | undefined,
  filter: SpecStatusFilter,
): boolean {
  return filter === "all" || status === filter;
}
