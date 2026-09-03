/** Doc lifecycle-status parsing for specs/ADRs (shared by the `require-statement-links` ESLint rule): `rejected`/`retired` skip the rule, everything else warns; specs read a `| Status |` table row, ADRs read YAML frontmatter `status:`. */

export type DocKind = "spec" | "adr";
export type StatusBucket =
  "draft" | "in-progress" | "shipped" | "rejected" | "retired";
export type StatusTier = "skip" | "warn";

export interface DocStatus {
  /** Normalized bucket, or `null` when no status was found. */
  status: StatusBucket | null;
}

const BUCKETS: Array<{ status: StatusBucket; re: RegExp }> = [
  { status: "draft", re: /^draft/ },
  {
    status: "in-progress",
    re: /^(in progress|in review|planning|wip|proposed)/,
  },
  {
    // `accepted` folds into shipped, mirroring the web-ui status pill (apps/web-ui/src/lib/spec-status.ts).
    status: "shipped",
    re: /^(shipped|implemented|complete|accepted|done|live)/,
  },
  {
    // Shipped, then retired — a distinct terminal state from `rejected` (never accepted); both skip the rule.
    status: "retired",
    re: /^(retired|superseded|removed|deprecated|obsolete)/,
  },
  {
    status: "rejected",
    re: /^(rejected|abandoned)/,
  },
];

function bucketOf(value: string): StatusBucket | null {
  return BUCKETS.find((candidate) => candidate.re.test(value))?.status ?? null;
}

function specTableStatusValueRaw(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());

    if (cells.length < 3 || cells[1].toLowerCase() !== "status") {
      continue;
    }

    return cells[2].replace(/\*/g, "").trim();
  }

  return null;
}

function specTableStatusValue(content: string): string | null {
  return specTableStatusValueRaw(content)?.toLowerCase() ?? null;
}

function adrFrontmatterStatusValueRaw(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return null;
  }

  for (const line of match[1].split(/\r?\n/)) {
    const keyValue = line.match(/^status\s*:\s*(.+?)\s*$/i);

    if (keyValue) {
      return keyValue[1].replace(/["']/g, "").trim();
    }
  }

  return null;
}

function adrFrontmatterStatusValue(content: string): string | null {
  return adrFrontmatterStatusValueRaw(content)?.toLowerCase() ?? null;
}

export function parseDocStatus(content: string, kind: DocKind): DocStatus {
  const value =
    kind === "adr"
      ? adrFrontmatterStatusValue(content)
      : specTableStatusValue(content);

  return { status: value === null ? null : bucketOf(value) };
}

export interface DocStatusPill {
  status: StatusBucket;
  label: string;
}

const MAX_LABEL = 24;

/** Trims a spec's `| Status |` cell to its leading phrase: "Shipped (v3) — supersedes v1" → "Shipped". */
function pillLabel(raw: string): string {
  const label = raw
    .split(/\s+[—–-]\s+/)[0]
    .split(" (")[0]
    .trim();

  return (label || raw).slice(0, MAX_LABEL);
}

/** Status + display label for the /specs and /adrs list pills; separate from `parseDocStatus` since the pill preserves the doc's own casing. */
export function docStatusPill(
  content: string,
  kind: DocKind,
): DocStatusPill | null {
  const raw =
    kind === "adr"
      ? adrFrontmatterStatusValueRaw(content)
      : specTableStatusValueRaw(content);

  if (raw === null) {
    return null;
  }
  const status = bucketOf(raw.toLowerCase());

  if (status === null) {
    return null;
  }

  return {
    status,
    label:
      kind === "adr"
        ? (raw.charAt(0).toUpperCase() + raw.slice(1)).slice(0, MAX_LABEL)
        : pillLabel(raw),
  };
}

/** Enforcement tier: rejected/retired skip; shipped/draft/in-progress/unknown warn. */
export function statusTier(status: StatusBucket | null): StatusTier {
  return status === "rejected" || status === "retired" ? "skip" : "warn";
}

/** Rewrite status cell preserving leading space and width for table alignment. */
function replaceStatusCell(rawCell: string, label: string): string {
  const leading = rawCell.match(/^\s*/)?.[0] ?? " ";
  const core = `${leading}${label}`;
  const trailing = Math.max(1, rawCell.length - core.length);

  return `${core}${" ".repeat(trailing)}`;
}

export interface RewriteStatusOptions {
  /** Rewrite even over a terminal state (`shipped`/`retired`); off by default so spec-status-upkeep stays idempotent/promotion-only, on for the corpus-wide reconciliation's demotions. */
  allowTerminal?: boolean;
}

/** Deterministically flips a spec's `| Status | <value> |` row to `label`; returns null when no status row exists or (unless `allowTerminal`) the value is already terminal (idempotent). */
export function rewriteSpecStatusRow(
  content: string,
  label: string,
  opts: RewriteStatusOptions = {},
): string | null {
  const current = specTableStatusValue(content);

  if (current === null) {
    return null;
  }
  const bucket = bucketOf(current);

  if (!opts.allowTerminal && (bucket === "shipped" || bucket === "retired")) {
    return null;
  }

  const sep = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split("|");
    const statusIdx = cells.findIndex(
      (cell, idx) => idx > 0 && cell.trim().toLowerCase() === "status",
    );

    if (statusIdx === -1 || statusIdx + 1 >= cells.length) {
      continue;
    }
    cells[statusIdx + 1] = replaceStatusCell(cells[statusIdx + 1], label);
    lines[i] = cells.join("|");

    return lines.join(sep);
  }

  return null;
}

/** ADR counterpart of `rewriteSpecStatusRow`: flips the YAML frontmatter `status:` value; null if no frontmatter/status key. No terminal-state bail — the caller (corpus reconciliation) decides what to skip. */
export function rewriteAdrStatusRow(
  content: string,
  label: string,
): string | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatter) {
    return null;
  }
  const sep = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  // Frontmatter is delimited by the `---` on line 1 and the next `---`; only lines strictly inside it are eligible.
  const closing = lines.indexOf("---", 1);

  for (let i = 1; i < closing; i++) {
    if (!/^status\s*:\s*(.+?)\s*$/i.test(lines[i])) {
      continue;
    }
    lines[i] = lines[i].replace(/^(status\s*:\s*).+?\s*$/i, `$1${label}`);

    return lines.join(sep);
  }

  return null;
}
