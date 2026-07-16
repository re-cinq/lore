/**
 * spec-status-coverage — the lifecycle status a spec/ADR's test links entitle it
 * to claim.
 *
 * Status is the org's backlog signal: the web-UI pills render it, spec-status-upkeep
 * flips it, humans trust it. This module makes it a function of the corpus's own
 * `([validated by](test.ts#Lnn))` links rather than of whoever last edited the row:
 *
 *   no testable statement linked    -> draft
 *   some testable statements linked -> in-progress
 *   every testable statement linked -> shipped
 *
 * Two consumers agree through it, which is why it lives here rather than beside
 * either of them: the `lore/require-status-matches-coverage` ESLint rule (which
 * reports a doc whose row disagrees) and spec-status-upkeep FR1 (which opens the
 * PR that fixes it). A doc with no testable statements yields no tier — there is
 * nothing to infer from — and both callers leave it alone.
 *
 * Reuses the canonical segmenter + classifier + link parser, so a statement
 * counted here is counted the same way by the linker, the spec-coverage backfill
 * and the web-ui coverage bar.
 */

import {
  segmentStatements,
  buildIntroOrdinals,
  classifyByHeuristic,
} from "./spec-segment.js";
import { parseTestLinksInStatement } from "./spec-link-parser.js";
import { enforceTrue } from "./lib/enforce.js";
import type { DocKind, StatusBucket } from "./spec-status.js";

export type CoverageTier = "vacuous" | "none" | "partial" | "full";

/** A testable statement carrying no test link, and where it starts. */
export interface UnlinkedStatement {
  text: string;
  line: number;
}

export interface StatementCoverage {
  testable: number;
  linked: number;
  unlinked: UnlinkedStatement[];
}

/**
 * Single walk of a doc's testable statements. `require-statement-links` reads
 * `unlinked`; the status rules read the `testable`/`linked` tally.
 */
export function statementCoverage(content: string): StatementCoverage {
  const statements = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(statements);
  const coverage: StatementCoverage = { testable: 0, linked: 0, unlinked: [] };

  for (const statement of statements) {
    if (
      classifyByHeuristic(statement, introOrdinals).testability !== "testable"
    ) {
      continue;
    }
    coverage.testable++;

    if (parseTestLinksInStatement(statement.text).length > 0) {
      coverage.linked++;
      continue;
    }
    // `Statement.line` is optional (test doubles omit it); every statement from
    // `segmentStatements` carries one, but fall back to line 1 to be safe.
    coverage.unlinked.push({ text: statement.text, line: statement.line ?? 1 });
  }

  return coverage;
}

/** Testable, unlinked statements — the `require-statement-links` view. */
export function unlinkedTestableStatements(
  content: string,
): UnlinkedStatement[] {
  return statementCoverage(content).unlinked;
}

export function coverageTier(testable: number, linked: number): CoverageTier {
  if (testable === 0) {
    return "vacuous";
  }

  if (linked === 0) {
    return "none";
  }

  return linked < testable ? "partial" : "full";
}

const TIER_STATUS: Record<CoverageTier, StatusBucket | null> = {
  vacuous: null,
  none: "draft",
  partial: "in-progress",
  full: "shipped",
};

/**
 * The status bucket a tier entitles a doc to claim, or `null` for `vacuous` — no
 * testable statements means no derivable status.
 */
export function expectedStatus(tier: CoverageTier): StatusBucket | null {
  return TIER_STATUS[tier];
}

/** House surface form per corpus: spec table cells are Title Case, ADR
 *  frontmatter values lowercase. Both bucket back via `parseDocStatus`. */
const STATUS_LABEL: Record<DocKind, Partial<Record<StatusBucket, string>>> = {
  spec: { draft: "Draft", "in-progress": "In Progress", shipped: "Shipped" },
  adr: { draft: "draft", "in-progress": "in progress", shipped: "shipped" },
};

/** The literal a human (or a status-flip PR) writes into the status cell. Only
 *  the three ladder statuses have a label — the terminal `rejected` / `retired`
 *  are never derived from coverage, so asking for one is a caller bug. */
export function statusLabel(status: StatusBucket, kind: DocKind): string {
  const label = STATUS_LABEL[kind][status];

  enforceTrue(
    label !== undefined,
    Error,
    `no ${kind} label for status "${status}"`,
  );

  return label;
}

/**
 * The status `content` is entitled to claim, as the literal to write into its
 * status cell — or `null` when no tier is derivable (no testable statements).
 */
export function coverageStatusLabel(
  content: string,
  kind: DocKind,
): string | null {
  const { testable, linked } = statementCoverage(content);
  const status = expectedStatus(coverageTier(testable, linked));

  return status === null ? null : statusLabel(status, kind);
}
