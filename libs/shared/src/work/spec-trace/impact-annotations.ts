/** Renders GitHub Checks API annotations for a trace-impact report: `warning` on each coupled statement's changed range, `notice` on each orphan's deleted range. */

import type { ImpactStatement } from "./impact-statement.js";
import type {
  ChangedRange,
  ImpactAnnotation,
  ImpactReport,
  OrphanStatement,
} from "./impact-types.js";
import { parseRanges } from "./line-range.js";

const sectionLabel = (section?: string) => (section ? ` ${section}` : "");

function statementAnnotation(
  stmt: ImpactStatement,
  changed: ChangedRange[],
): ImpactAnnotation {
  const file = changed.find((c) => c.path === stmt.changedFile);
  const [start, end] = file?.ranges[0] ?? [1, 1];
  const test = stmt.tests.at(0);
  const coverage = test ? ` Covered by test ${test.file}:${test.line}.` : "";

  return {
    path: stmt.changedFile,
    start_line: start,
    end_line: end,
    annotation_level: "warning",
    title: `Lore: coupled to ${stmt.specTitle}`,
    message: `⚠ Coupled to Spec "${stmt.specTitle}"${sectionLabel(stmt.section)} — "${stmt.statementText}".${coverage} Verify this still holds. → ${stmt.statementAnchor}`,
  };
}

function orphanAnnotation(orphan: OrphanStatement): ImpactAnnotation {
  const coveredByParts = orphan.wasCoveredBy.split(":");
  const path = coveredByParts.at(0) ?? "";
  const range = coveredByParts.at(1);
  const [start, end] = parseRanges(range ?? "").at(0) ?? [1, 1];

  return {
    path,
    start_line: start,
    end_line: end,
    annotation_level: "notice",
    title: `Lore: coverage removed for ${orphan.specTitle}`,
    message: `ℹ Removes the only coverage for Spec "${orphan.specTitle}" — "${orphan.statementText}". No test now exercises it.`,
  };
}

export function buildImpactAnnotations(
  report: ImpactReport,
  changed: ChangedRange[],
): ImpactAnnotation[] {
  return [
    ...report.statements.map((stmt) => statementAnnotation(stmt, changed)),
    ...report.orphaned.map((orphan) => orphanAnnotation(orphan)),
  ];
}
