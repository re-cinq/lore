/** Renders one impact statement as a comment block, and groups/caps statements by spec — the per-finding half of the sticky PR comment. */

import type { ImpactStatement } from "./impact-statement.js";
import { summarizeStatement, windowRewrite } from "./impact-render.js";

/** Rows shown before the rest is folded away — a wall of them reads as noise. */
export const MAX_ROWS = 10;

/** Collapses findings that would render identically — #1077 showed the same test/file pair four times. */
export function dedupeRows(statements: ImpactStatement[]): ImpactStatement[] {
  const seen = new Set<string>();

  return statements.filter((s) => {
    // JSON, not a delimiter: statement prose routinely contains pipes (markdown tables) that could forge a single-char separator.
    const key = JSON.stringify([
      s.specPath,
      s.statementText,
      testCellFor(s),
      s.changedFile,
    ]);

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
}

function testCellFor(s: ImpactStatement): string {
  const { tests } = s;

  return tests.length === 0 ? "—" : `${tests[0].file}:${tests[0].line}`;
}

/** Findings grouped under the spec they belong to, capped. */
export function specSections(statements: ImpactStatement[]): string[] {
  const bySpec = groupBySpec(statements);
  const lines: string[] = [];
  let rendered = 0;

  for (const [specPath, found] of bySpec) {
    if (rendered >= MAX_ROWS) {
      break;
    }
    const shownCount = MAX_ROWS - rendered;

    rendered += Math.min(shownCount, found.length);
    lines.push(...specSection(specPath, found, shownCount));
  }
  const hidden = statements.length - rendered;

  if (hidden > 0) {
    lines.push("", `…and ${hidden} more statement(s).`);
  }

  return lines;
}

function groupBySpec(
  statements: ImpactStatement[],
): Map<string, ImpactStatement[]> {
  const bySpec = new Map<string, ImpactStatement[]>();

  for (const s of statements) {
    const key = s.specPath || s.specTitle;

    bySpec.set(key, [...(bySpec.get(key) ?? []), s]);
  }

  return bySpec;
}

/** One spec's section header + its (possibly capped) statement blocks. */
function specSection(
  specPath: string,
  found: ImpactStatement[],
  shownCount: number,
): string[] {
  const shown = found.slice(0, shownCount);
  const title = found.find((s) => s.specTitle)?.specTitle ?? "";

  return [
    "",
    `### ${title || specPath} · ${found.length} statement(s)`,
    ...(title ? [`\`${specPath}\``] : []),
    ...shown.flatMap((s) => ["", ...statementBlock(s)]),
  ];
}

/** A statement rendered as a block, not a table row — tables forced paragraph-length prose into unreadable columns. */
function statementBlock(s: ImpactStatement): string[] {
  const before = summarizeStatement(s.statementText);
  const after = s.rewrittenAs ? summarizeStatement(s.rewrittenAs) : null;

  return [
    `**${statementLabel(s)}**`,
    s.testsTouched
      ? "✓ this PR also changes the tests that validate it"
      : "⚠ the tests that validate it are **not** touched by this PR",
    ...rewriteLines(before, after, s.section),
    "",
    `validated by ${testsCell(s.tests)}`,
    ...(s.changedFile !== s.specPath
      ? [`via changed file \`${s.changedFile}\``]
      : []),
  ];
}

/** Short label for a statement: its section if it has one, else its opening words. */
function statementLabel(s: ImpactStatement): string {
  const summary = summarizeStatement(s.statementText);

  if (s.section) {
    return s.section;
  }

  return summary.length > 60 ? `${summary.slice(0, 59)}…` : summary;
}

/** The rewrite section: a windowed diff for a real text change, a links-only note when only parentheticals moved, else a plain quote. */
function rewriteLines(
  before: string,
  after: string | null,
  section: string | undefined,
): string[] {
  if (after && after !== before) {
    return windowedDiffLines(before, after);
  }

  if (after) {
    return linksOnlyLines(before, section);
  }

  // Without a section the label already carried this text; repeating it would print the same sentence twice.
  return section ? ["", `> ${before}`] : [];
}

/** Windowed on the divergence: truncating both sides at the same length would render two identical-looking lines. */
function windowedDiffLines(before: string, after: string): string[] {
  const win = windowRewrite(before, after);

  return ["", "```diff", `- ${win.before}`, `+ ${win.after}`, "```"];
}

/** Texts are identical once ([validated by …]) parentheticals are stripped — only the coverage annotation moved. */
function linksOnlyLines(before: string, section: string | undefined): string[] {
  return [
    "",
    "only its test links changed — the statement text itself is unchanged",
    ...(section ? ["", `> ${before}`] : []),
  ];
}

/** The validating tests as one cell: the first four, then a count of the rest. */
function testsCell(tests: ImpactStatement["tests"]): string {
  if (tests.length === 0) {
    return "_nothing validates it_";
  }
  const shown = tests.slice(0, 4).map((t) => `\`${t.file}:${t.line}\``);
  const rest = tests.length > 4 ? `, +${tests.length - 4} more` : "";

  return shown.join(", ") + rest;
}
