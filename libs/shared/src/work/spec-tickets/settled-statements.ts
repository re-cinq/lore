// The statements a spec-tickets run takes as present on their linked tests alone, so the decompose agent assesses what changed since the spec's last run rather than every statement (specs/spec-tickets FR25).
import type { StatementAssessment } from "../../domain/feature-planning/decomposition-result.js";
import type { ImplementationEvidence } from "../../domain/feature-planning/grounding.js";
import { testableStatements } from "../../domain/feature-planning/issue-coverage.js";
import { linesWithHash } from "../../domain/anchor-hash.js";
import {
  checkableTestLinks,
  withoutTrailingLinkGroup,
  type TestLinkRef,
} from "../../domain/spec-link-parser.js";
import type { Statement } from "../../domain/spec-segment.js";
import { resolveAnchorLine } from "../../domain/spec-trace/resolve-anchor-line.js";
import { cachedRead } from "./implementation-assessment.js";

/** What the spec's last successful run saw: the spec it planned and what it found each statement to be. */
export interface SettleBaseline {
  /** The spec as that run read it; null when there is nothing to compare with, which settles nothing. */
  spec: string | null;
  /** That run's verified statements, their lines numbered in `spec`. */
  statements: readonly StatementAssessment[];
}

/** A spec and the repository it cites, both as one commit holds them. */
export interface CitedSpec {
  spec: string;
  specPath: string;
  /** A repository file at the commit the spec is read at. */
  read(path: string): Promise<string | null>;
}

export interface SettleInput extends CitedSpec {
  baseline: SettleBaseline;
}

type IsUnchanged = (statement: Statement) => boolean;
type IsCandidate = (statements: readonly Statement[], line: number) => boolean;

/** One `present` assessment per spec line whose statements all stand as the baseline left them and are all shown by linked tests that resolve, with those test lines as its evidence. */
export async function settledStatements(
  input: SettleInput,
): Promise<StatementAssessment[]> {
  const unchanged = unchangedSince(input);

  return settledWhere(input, (statements) => statements.every(unchanged));
}

/** The same assessments for the lines a run's load step listed, derived again from the links: a listed line whose links no longer all resolve, or that holds no testable statement, gets none. */
export async function settledOn(
  cited: CitedSpec,
  lines: readonly number[],
): Promise<StatementAssessment[]> {
  const listed = new Set(lines);

  return settledWhere(cited, (_, line) => listed.has(line));
}

/** The listing a run's load step hands on: the lines it settled, and the commit of the spec it compared this one with. */
export function settledListing(
  since: string | null,
  settled: readonly StatementAssessment[],
): string {
  return JSON.stringify({ since, lines: settled.map(({ line }) => line) });
}

/** The lines a listing names; none when it names none. */
export function listedLines(listing: string): number[] {
  const { lines } = JSON.parse(listing) as { lines?: unknown };

  return Array.isArray(lines) ? lines.filter(Number.isInteger) : [];
}

async function settledWhere(
  cited: CitedSpec,
  isCandidate: IsCandidate,
): Promise<StatementAssessment[]> {
  const read = cachedRead(cited.read);
  const parts = [...byLine(testableStatements(cited.spec))].filter(
    ([line, statements]) => isCandidate(statements, line),
  );
  const settled = await Promise.all(
    parts.map(([line, statements]) =>
      settledPart({ ...cited, read }, line, statements),
    ),
  );

  return settled.flat();
}

function byLine(statements: readonly Statement[]): Map<number, Statement[]> {
  const parts = new Map<number, Statement[]>();

  for (const statement of statements) {
    const line = statement.line ?? 1;

    parts.set(line, [...(parts.get(line) ?? []), statement]);
  }

  return parts;
}

// A statement a merge added or reworded is the agent's to assess, and so is one the last run found short: a link proves nothing about either.
function unchangedSince({
  spec,
  specPath,
  baseline,
}: SettleInput): IsUnchanged {
  if (baseline.spec === null) {
    return () => false;
  }
  const before = testableStatements(baseline.spec);
  const held = heldTexts(before, baseline.statements, specPath);
  const known = countByText(before);
  const now = countByText(testableStatements(spec));

  return (statement) => {
    const text = textOf(statement);

    return !held.has(text) && (known.get(text) ?? 0) >= (now.get(text) ?? 0);
  };
}

/** The statement as the guard compares it: its link group, spacing and closing period aside, so adding a link changes nothing. */
function textOf(statement: Statement): string {
  return withoutTrailingLinkGroup(statement.text)
    .replace(/\s+/g, " ")
    .replace(/[\s.]+$/, "");
}

// Counted, so a second copy of a sentence under another heading reads as new.
function countByText(statements: readonly Statement[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const text of statements.map(textOf)) {
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }

  return counts;
}

/** The texts the baseline run found partial, or missing for a stated reason: verdicts an agent reached by reading the code, which stand until a run verifies the statement present. */
function heldTexts(
  before: readonly Statement[],
  verdicts: readonly StatementAssessment[],
  specPath: string,
): Set<string> {
  const lines = new Set(
    verdicts
      .filter((verdict) => verdict.file === specPath && foundShort(verdict))
      .map((verdict) => verdict.line),
  );

  return new Set(
    before.filter((statement) => lines.has(statement.line ?? 1)).map(textOf),
  );
}

function foundShort({ status, reason }: StatementAssessment): boolean {
  return status === "partial" || (status === "missing" && reason !== undefined);
}

async function settledPart(
  { specPath, read }: CitedSpec,
  line: number,
  statements: readonly Statement[],
): Promise<StatementAssessment[]> {
  const links = statements.map((statement) =>
    checkableTestLinks(statement.text, specPath),
  );
  const cited = await Promise.all(
    links.flat().map(async (link) => citedLine(link, await read(link.path))),
  );
  const evidence = cited.flatMap((entry) => (entry ? [entry] : []));
  const shown =
    links.every((own) => own.length > 0) && evidence.length === cited.length;

  return shown ? [presentOn(specPath, line, evidence)] : [];
}

function presentOn(
  file: string,
  line: number,
  evidence: ImplementationEvidence[],
): StatementAssessment {
  return { file, line, status: "present", evidence: distinct(evidence) };
}

/** The line a link cites, as evidence; null when the link does not resolve: no file, no line, a blank line, or a hash the file no longer carries. */
function citedLine(
  link: TestLinkRef,
  content: string | null,
): ImplementationEvidence | null {
  if (content === null || hashIsGone(link, content)) {
    return null;
  }
  const line = resolveAnchorLine(link, content) ?? 0;
  const text = (linesOf(content)[line - 1] ?? "").trim();

  return text === "" ? null : { path: link.path, start: line, end: line, text };
}

// A link with no hash is taken at its line: a line too short to hash, such as `it.each([`, never carries one.
function hashIsGone(link: TestLinkRef, content: string): boolean {
  return link.hash !== null && linesWithHash(content, link.hash).length === 0;
}

// Split as the evidence check splits a file, so a cited line verifies at the number it is given.
function linesOf(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function distinct(
  evidence: ImplementationEvidence[],
): ImplementationEvidence[] {
  const seen = new Map<string, ImplementationEvidence>();

  for (const entry of evidence) {
    seen.set(`${entry.path}#L${entry.start}`, entry);
  }

  return [...seen.values()];
}
