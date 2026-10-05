// How much of a merged spec its task issues carry: every task names the spec.md lines where the statements it implements begin, its issue links each one, and the coverage check on the feature-planning line counts the testable statements no task names.

import {
  buildIntroOrdinals,
  classifyByHeuristic,
  segmentStatements,
  type Statement,
} from "../spec-segment.js";
import { withoutTrailingLinkGroup } from "../spec-link-parser.js";

/** One testable part of the spec: the statements that start on one line, which a line link can name — a list item, or a paragraph's sentences together. */
export interface SpecPart {
  line: number;
  text: string;
}

export function specParts(specMd: string): SpecPart[] {
  const statements = segmentStatements(specMd);
  const introOrdinals = buildIntroOrdinals(statements);
  const testable = statements.filter(
    (statement) =>
      classifyByHeuristic(statement, introOrdinals).testability === "testable",
  );

  const textsByLine = new Map<number, string[]>();

  for (const statement of testable) {
    const line = lineOf(statement);

    textsByLine.set(line, [
      ...(textsByLine.get(line) ?? []),
      withoutTrailingLinkGroup(statement.text),
    ]);
  }

  return [...textsByLine].map(([line, texts]) => ({
    line,
    text: texts.join(" "),
  }));
}

// `Statement.line` is optional for hand-built doubles; segmentStatements always sets it.
function lineOf(statement: Statement): number {
  return statement.line ?? 1;
}

/** The part a cited line falls in: the last one starting at or before it. A line before every part names none, and is dropped rather than objected to. */
export function partAt(
  parts: readonly SpecPart[],
  line: number,
): SpecPart | undefined {
  return parts.findLast((part) => part.line <= line);
}

/** The parts some of `lines` fall in, once each, in spec order. */
export function partsNamed(
  parts: readonly SpecPart[],
  lines: readonly number[],
): SpecPart[] {
  const named = new Set(lines.map((line) => partAt(parts, line)));

  return parts.filter((part) => named.has(part));
}

export interface IssueCoverage {
  total: number;
  covered: number;
  missing: SpecPart[];
}

/** Which of the spec's testable parts some task names in its `spec_lines`. */
export function issueCoverage(
  parts: readonly SpecPart[],
  tasks: readonly { spec_lines?: number[] }[],
): IssueCoverage {
  const named = new Set(
    partsNamed(
      parts,
      tasks.flatMap((task) => task.spec_lines ?? []),
    ),
  );
  const missing = parts.filter((part) => !named.has(part));

  return {
    total: parts.length,
    covered: parts.length - missing.length,
    missing,
  };
}

/** The spec.md a plan's `spec_path` names: the file itself, or the spec.md in the spec-kit directory. */
export function specFileOf(specPath: string): string {
  return specPath.endsWith(".md")
    ? specPath
    : `${specPath.replace(/\/+$/, "")}/spec.md`;
}

export interface StatementLinkInput {
  repo: string;
  file: string;
  /** The commit or branch the spec was read at, so the line is the one decompose saw. */
  ref: string;
  line: number;
}

export function statementLink({
  repo,
  file,
  ref,
  line,
}: StatementLinkInput): string {
  return `https://github.com/${repo}/blob/${ref}/${file}#L${line}`;
}

/** The coverage as the story issue shows it and decompose's next round reads it. */
export function issueCoverageBrief(
  { total, covered, missing }: IssueCoverage,
  linkOf: (line: number) => string,
): string {
  const summary = `${covered} of ${total} testable spec statements have a task.`;

  if (missing.length === 0) {
    return `## Spec coverage\n\n${summary}\n`;
  }

  return [
    "## Spec coverage",
    "",
    `${summary} Not covered yet:`,
    "",
    ...missing.map(
      ({ line, text }) => `- line ${line}: ${text} — ${linkOf(line)}`,
    ),
    "",
  ].join("\n");
}
