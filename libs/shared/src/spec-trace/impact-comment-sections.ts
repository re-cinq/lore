/** Renders one impact statement as a comment block, and groups/caps statements by spec — the per-finding half of the sticky PR comment. */

import type { ImpactStatement } from "./impact-statement.js";
import { summarizeStatement, windowRewrite } from "./impact-render.js";

/** Rows shown before the rest is folded away — a wall of them reads as noise. */
export const MAX_ROWS = 10;

const testCellFor = (s: ImpactStatement) =>
  s.tests[0] ? `${s.tests[0].file}:${s.tests[0].line}` : "—";

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
    // Windowed on the divergence: truncating both sides at the same length would render two identical-looking lines.
    const win = windowRewrite(before, after);

    return ["", "```diff", `- ${win.before}`, `+ ${win.after}`, "```"];
  }

  if (after) {
    // Texts are identical once ([validated by …]) parentheticals are stripped — only the coverage annotation moved.
    return [
      "",
      "only its test links changed — the statement text itself is unchanged",
      ...(section ? ["", `> ${before}`] : []),
    ];
  }

  if (section) {
    // Without a section the label already carried this text; repeating it would print the same sentence twice.
    return ["", `> ${before}`];
  }

  return [];
}

/** A statement rendered as a block, not a table row — tables forced paragraph-length prose into unreadable columns. */
function statementBlock(s: ImpactStatement): string[] {
  const before = summarizeStatement(s.statementText);
  const after = s.rewrittenAs ? summarizeStatement(s.rewrittenAs) : null;
  const lines = [`**${statementLabel(s)}**`];

  lines.push(
    s.testsTouched
      ? "✓ this PR also changes the tests that validate it"
      : "⚠ the tests that validate it are **not** touched by this PR",
  );

  lines.push(...rewriteLines(before, after, s.section));

  const tests = s.tests.length
    ? s.tests
        .slice(0, 4)
        .map((t) => `\`${t.file}:${t.line}\``)
        .join(", ") +
      (s.tests.length > 4 ? `, +${s.tests.length - 4} more` : "")
    : "_nothing validates it_";

  lines.push("", `validated by ${tests}`);

  if (s.changedFile !== s.specPath) {
    lines.push(`via changed file \`${s.changedFile}\``);
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
