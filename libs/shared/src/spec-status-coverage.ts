/** Derives a spec/ADR's status (draft/in-progress/shipped) from its own `([validated by](test.ts#Lnn))` links rather than whoever last edited the row; shared by `lore/require-status-matches-coverage` and spec-status-upkeep FR1. */

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

/** Single walk of a doc's testable statements; `require-statement-links` reads `unlinked`, status rules read `testable`/`linked`. */
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
    // `Statement.line` is optional (test doubles omit it), so fall back to line 1.
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

/** The status bucket a tier entitles a doc to claim, or `null` for `vacuous` (no testable statements to infer from). */
export function expectedStatus(tier: CoverageTier): StatusBucket | null {
  return TIER_STATUS[tier];
}

/** House surface form per corpus: spec table cells are Title Case, ADR frontmatter values lowercase; both bucket back via `parseDocStatus`. */
const STATUS_LABEL: Record<DocKind, Partial<Record<StatusBucket, string>>> = {
  spec: { draft: "Draft", "in-progress": "In Progress", shipped: "Shipped" },
  adr: { draft: "draft", "in-progress": "in progress", shipped: "shipped" },
};

/** The literal a human/status-flip PR writes into the status cell; only the three ladder statuses have a label (terminal `rejected`/`retired` are never derived from coverage). */
export function statusLabel(status: StatusBucket, kind: DocKind): string {
  const label = STATUS_LABEL[kind][status];

  enforceTrue(
    label !== undefined,
    Error,
    `no ${kind} label for status "${status}"`,
  );

  return label;
}

/** The status `content` is entitled to claim, as the literal to write into its status cell, or `null` when no tier is derivable. */
export function coverageStatusLabel(
  content: string,
  kind: DocKind,
): string | null {
  const { testable, linked } = statementCoverage(content);
  const status = expectedStatus(coverageTier(testable, linked));

  return status === null ? null : statusLabel(status, kind);
}
