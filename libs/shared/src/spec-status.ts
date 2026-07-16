/**
 * Doc lifecycle-status parsing for the spec/ADR corpus, shared by the
 * `require-statement-links` ESLint rule to pick the enforcement tier: a
 * finalized doc errors on unlinked testable statements, everything else warns.
 *
 * Two source shapes:
 *   - spec.md — a `| Status | <value> |` markdown table row (bucketed like the
 *     web-ui status pill in apps/web-ui/src/lib/spec-status.ts).
 *   - ADR .md — YAML frontmatter `status: <value>` (accepted/proposed/superseded).
 *
 * "Finalized" = a spec in the shipped bucket, or an `accepted` ADR.
 */

export type DocKind = "spec" | "adr";

export interface DocStatus {
  /** Normalized bucket for specs (draft/in-progress/shipped/rejected); the raw
   * lowercased frontmatter value for ADRs. `null` when no status was found. */
  status: string | null;
  isFinalized: boolean;
}

const SPEC_BUCKETS: Array<{ status: string; re: RegExp }> = [
  { status: "draft", re: /^draft/ },
  { status: "in-progress", re: /^(in progress|in review|planning|wip)/ },
  {
    status: "shipped",
    re: /^(shipped|implemented|complete|accepted|done|live)/,
  },
  {
    status: "rejected",
    re: /^(rejected|superseded|abandoned|obsolete|deprecated)/,
  },
];

function parseSpecTableStatus(content: string): DocStatus {
  for (const line of content.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());

    if (cells.length < 3 || cells[1].toLowerCase() !== "status") {
      continue;
    }
    const value = cells[2].replace(/\*/g, "").trim().toLowerCase();
    const bucket = SPEC_BUCKETS.find((candidate) => candidate.re.test(value));

    return {
      status: bucket?.status ?? null,
      isFinalized: bucket?.status === "shipped",
    };
  }

  return { status: null, isFinalized: false };
}

function parseAdrFrontmatterStatus(content: string): DocStatus {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return { status: null, isFinalized: false };
  }

  for (const line of match[1].split(/\r?\n/)) {
    const keyValue = line.match(/^status\s*:\s*(.+?)\s*$/i);

    if (!keyValue) {
      continue;
    }
    const status = keyValue[1].replace(/["']/g, "").trim().toLowerCase();

    return { status, isFinalized: status === "accepted" };
  }

  return { status: null, isFinalized: false };
}

export function parseDocStatus(content: string, kind: DocKind): DocStatus {
  return kind === "adr"
    ? parseAdrFrontmatterStatus(content)
    : parseSpecTableStatus(content);
}
