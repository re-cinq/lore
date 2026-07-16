/**
 * Doc lifecycle-status parsing for the spec/ADR corpus, shared by the
 * `require-statement-links` ESLint rule to pick the enforcement tier.
 *
 * Every spec and ADR is normalized into the same four buckets — the linter
 * treats specs and ADRs consistently:
 *   - `rejected`  → the rule does not run (skip)
 *   - every other status (`shipped` / `draft` / `in-progress` / unknown) → warn
 *
 * Two source shapes feed the same buckets:
 *   - spec.md — a `| Status | <value> |` markdown table row (bucketed like the
 *     web-ui status pill in apps/web-ui/src/lib/spec-status.ts).
 *   - ADR .md — YAML frontmatter `status: <value>`; `accepted` folds into
 *     `shipped`, `proposed` into `in-progress`, `superseded` into `rejected`.
 */

export type DocKind = "spec" | "adr";
export type StatusBucket = "draft" | "in-progress" | "shipped" | "rejected";
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
    status: "rejected",
    re: /^(rejected|superseded|abandoned|obsolete|deprecated)/,
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

/** Enforcement tier for a bucket: `rejected` skips the rule, every other
 * status (shipped / draft / in-progress / unknown) warns. */
export function statusTier(status: StatusBucket | null): StatusTier {
  return status === "rejected" ? "skip" : "warn";
}

/** Rewrite a status value cell to `label`, preserving the leading space and the
 *  original cell width so the table stays aligned when the label fits. */
function replaceStatusCell(rawCell: string, label: string): string {
  const leading = rawCell.match(/^\s*/)?.[0] ?? " ";
  const core = `${leading}${label}`;
  const trailing = Math.max(1, rawCell.length - core.length);

  return `${core}${" ".repeat(trailing)}`;
}

/**
 * Deterministically flip a spec's `| Status | <value> |` header row to `label`.
 * Returns the rewritten markdown, or `null` when there is nothing to do — no
 * status row exists, or the current value already buckets to `shipped`
 * (implemented/complete/accepted/…), which makes the flip idempotent. Only the
 * status value cell changes; every other line is left byte-for-byte intact.
 */
export function rewriteSpecStatusRow(
  content: string,
  label: string,
): string | null {
  const current = specTableStatusValue(content);

  if (current === null || bucketOf(current) === "shipped") {
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
