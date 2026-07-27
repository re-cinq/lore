/**
 * status-coverage — the pure core behind `require-status-matches-coverage`.
 *
 * The coverage math itself (`statementCoverage` -> `coverageTier` ->
 * `expectedStatus`) lives in `@re-cinq/lore-shared` because spec-status-upkeep
 * FR1 opens the PR that fixes what this rule reports, and the two must agree on
 * what a doc's links entitle it to claim. What is rule-specific — comparing that
 * against the declared status, and locating the row a human has to edit — lives
 * here.
 *
 * Split out of the rule so it is testable without a RuleTester.
 */

import {
  coverageTier,
  expectedStatus,
  parseDocStatus,
  statementCoverage,
  statusTier,
} from "./lore-shared.mjs";

/**
 * @typedef {{ reason: "untagged", line: number }} UntaggedMismatch
 * @typedef {{ reason: "tier", expected: string, actual: string, testable: number, linked: number, line: number }} TierMismatch
 */

/**
 * 1-based line of the doc's declared status, so a report anchors on the cell a
 * human has to edit. Mirrors the source shapes `parseDocStatus` reads — a spec's
 * `| Status | <value> |` table row, an ADR's frontmatter `status:` — including
 * its first-match-wins rule (several API-route specs carry a second
 * `| Status | Body |` table documenting HTTP codes; the header row wins).
 *
 * @returns {number | null} null when the doc declares no status at all
 */
function statusLine(content, kind) {
  const lines = content.split(/\r?\n/);

  if (kind === "spec") {
    const index = lines.findIndex((line) => {
      const cells = line.split("|").map((cell) => cell.trim());

      return cells.length >= 3 && cells[1].toLowerCase() === "status";
    });

    return index === -1 ? null : index + 1;
  }

  if (!/^---\r?\n([\s\S]*?)\r?\n---/.test(content)) {
    return null;
  }
  const index = lines.findIndex((line) =>
    /^status\s*:\s*(.+?)\s*$/i.test(line),
  );

  return index === -1 ? null : index + 1;
}

/**
 * @param {string} content markdown body of a spec.md / ADR file
 * @param {"spec" | "adr"} kind
 * @returns {UntaggedMismatch | TierMismatch | null} null when the doc is consistent or skipped
 */
export function statusMismatch(content, kind) {
  const { status } = parseDocStatus(content, kind);

  if (statusTier(status) === "skip") {
    return null;
  }
  const line = statusLine(content, kind) ?? 1;

  if (status === null) {
    return { reason: "untagged", line };
  }
  const { testable, linked } = statementCoverage(content);
  const expected = expectedStatus(coverageTier(testable, linked));

  if (expected === null || expected === status) {
    return null;
  }

  return { reason: "tier", expected, actual: status, testable, linked, line };
}
