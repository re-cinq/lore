/** Renders the sticky PR summary comment (find-by-marker, update-in-place) for a trace-impact report — the prose/narration half. */

import type { ImpactStatement } from "./impact-statement.js";
import type { ImpactReport, OrphanStatement } from "./impact-types.js";
import { dedupeRows, specSections } from "./impact-comment-sections.js";

/** HTML-comment marker that makes the PR summary comment sticky (updated in place). */
export const IMPACT_COMMENT_MARKER = "<!-- lore-trace-impact -->";

const COMMENT_HEADER = "## 🔍 Lore Spec Impact";

/** Say what was actually examined — a bare "No spec impact detected" over ungraphed files reads as a clean bill of health and taught people to skim past this check. */
function describeExamined(report: ImpactReport): string {
  const seen = report.examined;

  if (!seen) {
    return "No spec impact detected for this PR.";
  }
  // Docs are examined at statement level (neither "had graph data" nor blind); clamped since a doc could also carry line data.
  const blind = Math.max(0, seen.files - seen.withGraphData - seen.docs);
  const parts = [
    `Examined **${seen.files} changed file(s)**: ${seen.withGraphData} had graph data (no coupling found), ${blind} had none — no ingested test run covers them, so this check cannot speak for them.`,
  ];

  const notes = docNotes(seen);

  if (seen.docs) {
    // Only claim nothing moved when nothing did — asserting it beside a nonzero changed-statement count is the contradiction that teaches people to stop reading.
    parts.push(
      notes.length
        ? `Also read **${seen.docs} changed spec/ADR** at statement level.`
        : `Also read **${seen.docs} changed spec/ADR** at statement level; no projected statement changed.`,
    );
  }

  parts.push(...notes);

  return parts.join(" ");
}

/** Doc-side populations counted rather than listed, reported even when nothing else is so a bounded output never reads as empty. */
function docNotes(seen: NonNullable<ImpactReport["examined"]>): string[] {
  const notes: string[] = [];

  if (seen.changedWithoutTests) {
    notes.push(
      `**${seen.changedWithoutTests} changed statement(s)** had no validating test, so no coverage broke.`,
    );
  }

  if (seen.newStatements) {
    notes.push(
      `**${seen.newStatements} new statement(s)** have no test link yet.`,
    );
  }

  return notes;
}

/** The provenance line: says which commit the graph's ranges belong to, or plainly that the repo has never been stamped (was silently `graph @ unknown` before). */
function describeBaseline(report: ImpactReport): string {
  const unaligned = (report.skipped ?? []).filter(
    (s) => s.reason === "unaligned",
  ).length;
  const skipNote = unaligned
    ? ` · ${unaligned} file(s) skipped: changed since the graph last saw them, so their line numbers no longer line up`
    : "";

  if (!report.graphCommit) {
    return "graph baseline unknown (no ingested test run has stamped this repo) — line-precise coupling skipped";
  }
  const at = report.graphCommitAt
    ? ` (projected ${report.graphCommitAt.slice(0, 10)})`
    : "";

  return `graph @ \`${report.graphCommit.slice(0, 7)}\`${at}${skipNote}`;
}

/** A statement with no resolvable spec is a broken graph edge, not a finding — rendering it produced the blank table rows in #1077. */
function commentFindings(report: ImpactReport): ImpactStatement[] {
  return dedupeRows(
    report.statements.filter(
      (s) => s.specTitle || s.specPath || s.statementText,
    ),
  );
}

/** Same footer as a populated result — otherwise a run that skipped every file for want of a baseline looks identical to a clean "found nothing" run. */
function emptyImpactComment(report: ImpactReport): string {
  return [
    COMMENT_HEADER,
    "",
    describeExamined(report),
    "",
    `<sub>Deterministic · ${describeBaseline(report)} · no tests run by this check</sub>`,
    "",
    IMPACT_COMMENT_MARKER,
    "",
  ].join("\n");
}

function commentIntro(findings: ImpactStatement[]): string {
  const specCount = new Set(findings.map((s) => s.specPath)).size;
  const untouched = findings.filter((s) => !s.testsTouched).length;
  const untouchedNote = untouched
    ? `, and **${untouched}** of them ${untouched === 1 ? "has" : "have"} validating tests this PR does not change.`
    : ", and changes the validating tests alongside every one of them.";

  return `This PR touches **${findings.length} statement(s)** across **${specCount} spec(s)**${untouchedNote}`;
}

function orphanWarningLines(orphaned: OrphanStatement[]): string[] {
  if (!orphaned.length) {
    return [];
  }

  return [
    "",
    `### ⚠ Coverage warnings (${orphaned.length})`,
    ...orphaned.map(
      (o) =>
        `- **${o.specTitle}** lost its only coverage — was \`${o.wasCoveredBy}\`, now deleted.`,
    ),
  ];
}

function weakSignalLines(weak: ImpactStatement[]): string[] {
  if (!weak.length) {
    return [];
  }

  return [
    "",
    `<details><summary>Weaker signals (${weak.length}) — linked by a spec, not proven by a test run</summary>`,
    ...specSections(weak),
    "",
    "</details>",
  ];
}

/** The two fixed-text cases that short-circuit rendering entirely: no graph, or an unsupported client protocol. */
function suppressedComment(report: ImpactReport): string | undefined {
  if (report.status === "unavailable") {
    return `${COMMENT_HEADER}\n\nGraph not available for this repo yet — skipping impact analysis. No action needed.\n\n${IMPACT_COMMENT_MARKER}\n`;
  }

  if (report.protocol !== undefined && report.protocol < 2) {
    return `${COMMENT_HEADER}\n\nThis repo's \`.github/workflows/lore-trace-impact.yml\` is version 1, which computed its diff against the base-branch tip instead of the merge base — so it reported every commit merged to the base since the branch point as a change of this PR. Findings from it were unreliable and are suppressed. Update the workflow to re-enable this check.\n\n${IMPACT_COMMENT_MARKER}\n`;
  }

  return undefined;
}

function evidenceSplit(findings: ImpactStatement[]): {
  strong: ImpactStatement[];
  weak: ImpactStatement[];
} {
  return {
    strong: findings.filter(
      (s) => s.evidence === "statement-edit" || s.evidence === "coverage",
    ),
    weak: findings.filter(
      (s) => s.evidence === "test-link" || s.evidence === "file-link",
    ),
  };
}

/** Renders the sticky PR summary comment (find-by-marker, update-in-place); formatting lives here so it is unit-tested, not buried in workflow YAML. */
function populatedImpactComment(
  report: ImpactReport,
  findings: ImpactStatement[],
  strong: ImpactStatement[],
  weak: ImpactStatement[],
): string {
  const notes = report.examined ? docNotes(report.examined) : [];
  const lines = [
    `${COMMENT_HEADER} — advisory`,
    "",
    commentIntro(findings),
    ...(strong.length ? specSections(strong) : []),
    ...weakSignalLines(weak),
    ...(notes.length ? ["", notes.join(" ")] : []),
    ...orphanWarningLines(report.orphaned),
    "",
    `<sub>Deterministic · ${describeBaseline(report)} · no tests run by this check</sub>`,
    "",
    IMPACT_COMMENT_MARKER,
    "",
  ];

  return lines.join("\n");
}

export function buildImpactComment(report: ImpactReport): string {
  const suppressed = suppressedComment(report);

  if (suppressed !== undefined) {
    return suppressed;
  }

  const findings = commentFindings(report);
  const { strong, weak } = evidenceSplit(findings);

  if (!findings.length && !report.orphaned.length) {
    return emptyImpactComment(report);
  }

  return populatedImpactComment(report, findings, strong, weak);
}
