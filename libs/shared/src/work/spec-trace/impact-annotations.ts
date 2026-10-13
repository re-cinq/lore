/** Renders GitHub Checks API annotations for a trace-impact report: `warning` on each coupled statement's changed range, `notice` on each orphan's deleted range. */

import type { ImpactStatement } from "./impact-statement.js";
import type {
  ChangedRange,
  ImpactAnnotation,
  ImpactReport,
  OrphanStatement,
} from "./impact-types.js";
import { statementProse } from "./impact-render.js";
import { parseRanges } from "../../domain/spec-trace/line-range.js";

export function buildImpactAnnotations(
  report: ImpactReport,
  changed: ChangedRange[],
): ImpactAnnotation[] {
  return [
    ...report.statements.map((stmt) => statementAnnotation(stmt, changed)),
    ...report.orphaned.map((orphan) => orphanAnnotation(orphan)),
  ];
}

function statementAnnotation(
  stmt: ImpactStatement,
  changed: ChangedRange[],
): ImpactAnnotation {
  const file = changed.find((c) => c.path === stmt.changedFile);
  const [start, end] = file?.ranges[0] ?? [1, 1];

  return {
    path: stmt.changedFile,
    start_line: start,
    end_line: end,
    annotation_level: stmt.indirect ? "notice" : "warning",
    title: "Lore: coupled spec statement",
    message: statementReference(stmt),
  };
}

/** Where the statement is defined, then the statement itself: enough to find it, and its tests from there. */
function statementReference(statement: {
  specPath: string;
  section?: string;
  statementText: string;
}): string {
  const definedIn = [statement.specPath, statement.section]
    .filter(Boolean)
    .join(" › ");

  return `${definedIn}\n"${statementProse(statement.statementText)}"`;
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
    title: "Lore: only coverage removed",
    message: `Removes the only coverage for:\n${statementReference(orphan)}`,
  };
}
