/**
 * Doc lifecycle-status parsing for the spec/ADR corpus, shared by the
 * `require-statement-links` ESLint rule to pick the enforcement tier.
 *
 * Every spec and ADR is normalized into the same buckets — the linter treats
 * specs and ADRs consistently:
 *   - `rejected` (never accepted) and `retired` (shipped, then superseded/
 *     removed) → the rule does not run (skip)
 *   - every other status (`shipped` / `draft` / `in-progress` / unknown) → warn
 *
 * Two source shapes feed the same buckets:
 *   - spec.md — a `| Status | <value> |` markdown table row (bucketed like the
 *     web-ui status pill in apps/web-ui/src/lib/spec-status.ts).
 *   - ADR .md — YAML frontmatter `status: <value>`; `accepted` folds into
 *     `shipped`, `proposed` into `in-progress`, `retired` stays `retired`.
 */

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
    // `accepted` (with implemented/complete/…) folds into shipped, mirroring the
    // web-ui status pill (apps/web-ui/src/lib/spec-status.ts). The rule is
    // warn-only, so an "Accepted, pre-implementation" spec is nudged, not blocked.
    status: "shipped",
    re: /^(shipped|implemented|complete|accepted|done|live)/,
  },
  {
    // Shipped, then retired — superseded / removed / deprecated / obsolete. A
    // distinct terminal state from `rejected` (never accepted); both skip the
    // rule, but this one preserves the "was live" history.
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

function specTableStatusValue(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());

    if (cells.length < 3 || cells[1].toLowerCase() !== "status") {
      continue;
    }

    return cells[2].replace(/\*/g, "").trim().toLowerCase();
  }

  return null;
}

function adrFrontmatterStatusValue(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return null;
  }

  for (const line of match[1].split(/\r?\n/)) {
    const keyValue = line.match(/^status\s*:\s*(.+?)\s*$/i);

    if (keyValue) {
      return keyValue[1].replace(/["']/g, "").trim().toLowerCase();
    }
  }

  return null;
}

export function parseDocStatus(content: string, kind: DocKind): DocStatus {
  const value =
    kind === "adr"
      ? adrFrontmatterStatusValue(content)
      : specTableStatusValue(content);

  return { status: value === null ? null : bucketOf(value) };
}

/** Enforcement tier for a bucket: `rejected` and `retired` skip the rule (dead
 * specs), every other status (shipped / draft / in-progress / unknown) warns. */
export function statusTier(status: StatusBucket | null): StatusTier {
  return status === "rejected" || status === "retired" ? "skip" : "warn";
}

/** Rewrite a status value cell to `label`, preserving the leading space and the
 *  original cell width so the table stays aligned when the label fits. */
function replaceStatusCell(rawCell: string, label: string): string {
  const leading = rawCell.match(/^\s*/)?.[0] ?? " ";
  const core = `${leading}${label}`;
  const trailing = Math.max(1, rawCell.length - core.length);

  return `${core}${" ".repeat(trailing)}`;
}

export interface RewriteStatusOptions {
  /**
   * Rewrite even when the current value buckets to a terminal state
   * (`shipped` / `retired`). Off by default so the spec-status-upkeep flip stays
   * idempotent and promotion-only; the corpus-wide status reconciliation opts in
   * because a demotion is exactly a terminal-state rewrite.
   */
  allowTerminal?: boolean;
}

/**
 * Deterministically flip a spec's `| Status | <value> |` header row to `label`.
 * Returns the rewritten markdown, or `null` when there is nothing to do — no
 * status row exists, or (unless `allowTerminal` is set) the current value already
 * buckets to a terminal state: `shipped` (implemented/complete/accepted/…) or
 * `retired` (superseded/removed). That makes the flip idempotent and stops it
 * re-marking a retired spec. Only the status value cell changes; every other line
 * is left byte-for-byte intact.
 */
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

/**
 * The ADR counterpart of `rewriteSpecStatusRow`: flip the YAML frontmatter
 * `status:` value to `label`. Returns the rewritten markdown, or `null` when the
 * ADR has no frontmatter block or no `status:` key inside it. Only that one line
 * changes; a `status:`-looking line in the ADR body is left alone, mirroring
 * `adrFrontmatterStatusValue`'s read.
 *
 * Unlike the spec rewriter there is no terminal-state bail: the only caller is
 * the corpus status reconciliation, which decides what to skip from the doc's
 * coverage tier before calling.
 */
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
  // The frontmatter block is delimited by the `---` on line 1 and the next
  // `---`; only lines strictly inside it are eligible.
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
