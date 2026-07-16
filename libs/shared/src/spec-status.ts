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
