// Merges two layers with local precedence: inline spec.md links ("implemented") win over graph coverage ranges ("covered").

import {
  parseCodeLinksInStatement,
  parseTestLinksInStatement,
  type SpecLinkRef,
} from "@re-cinq/lore-shared/spec-link-parser.js";
import { segmentStatements } from "@re-cinq/lore-shared/spec-segment.js";

export type HighlightLayer = "implemented" | "covered";

export interface LinkTarget {
  label: string;
  /** Repo-relative file path. */
  path: string;
  /** 1-based line from a `#Lnn` anchor, or null when absent. */
  line: number | null;
}

export interface RangeEntry {
  /** 1-based inclusive range in the target file. */
  startLine: number;
  endLine: number;
  layer: HighlightLayer;
  evidence: "human-linked" | "execution-verified";
  /** The spec statement this range fulfils (cleaned of its trailing link soup). */
  statementText: string;
  specPath: string;
  /** 1-based line in the spec where the statement's link sits, or 0 if unknown. */
  specLine: number;
  /** The statement's other artifacts — tests for a code line, code for a test line. */
  related: LinkTarget[];
}

/** source-file relative path → ranges that highlight inside it. */
export type SpecCodeIndex = Map<string, RangeEntry[]>;

export interface SpecSource {
  path: string;
  content: string;
}

/** Parses local spec.md files into the implemented layer, cross-linking code and test lines per statement. */
export function buildLocalIndex(specs: SpecSource[]): SpecCodeIndex {
  const index: SpecCodeIndex = new Map();

  for (const spec of specs) {
    indexSpecStatements(index, spec);
  }

  return index;
}

function indexSpecStatements(index: SpecCodeIndex, spec: SpecSource): void {
  const lines = spec.content.split(/\r?\n/);

  for (const statement of segmentStatements(spec.content)) {
    const codeLinks = parseCodeLinksInStatement(statement.text);
    const testLinks = parseTestLinksInStatement(statement.text);

    if (codeLinks.length === 0 && testLinks.length === 0) {
      continue;
    }

    const entryBase = {
      layer: "implemented" as const,
      evidence: "human-linked" as const,
      statementText: cleanStatementText(statement.text),
      specPath: spec.path,
      specLine: locateStatementLine(lines, [...codeLinks, ...testLinks]),
    };

    addImplementedEntries(index, codeLinks, entryBase, testLinks.map(toTarget));
    addImplementedEntries(index, testLinks, entryBase, codeLinks.map(toTarget));
  }
}

/** Drop the trailing `([…](…))` link parenthetical so the hover shows prose. */
function cleanStatementText(text: string): string {
  const marker = text.indexOf(" ([");

  return (marker >= 0 ? text.slice(0, marker) : text).trim();
}

/** 1-based line of the first ref whose `path#Lnn` anchor appears in the spec. */
function locateStatementLine(lines: string[], refs: SpecLinkRef[]): number {
  for (const ref of refs) {
    const needle = ref.line !== null ? `${ref.path}#L${ref.line}` : ref.path;
    const idx = lines.findIndex((line) => line.includes(needle));

    if (idx >= 0) {
      return idx + 1;
    }
  }

  return 0;
}

/** One line-anchored implemented entry per linked line, cross-linked to the statement's other artifacts. */
function addImplementedEntries(
  index: SpecCodeIndex,
  links: SpecLinkRef[],
  entryBase: Omit<RangeEntry, "startLine" | "endLine" | "related">,
  related: LinkTarget[],
): void {
  for (const link of links) {
    if (link.line === null) {
      continue;
    }
    addEntry(index, link.path, {
      ...entryBase,
      startLine: link.line,
      endLine: link.line,
      related,
    });
  }
}

function toTarget(ref: SpecLinkRef): LinkTarget {
  return { label: ref.label, path: ref.path, line: ref.line };
}

function addEntry(index: SpecCodeIndex, path: string, entry: RangeEntry): void {
  const existing = index.get(path);

  if (existing) {
    existing.push(entry);

    return;
  }
  index.set(path, [entry]);
}

/** One covering test of a file as lore-api's `tests-covering` read answers it. */
export interface CoveringTestRanges {
  testFile: string;
  /** The spec statement the test validates; a test that validates none colours nothing. */
  statement?: string;
  /** 1-based inclusive line ranges of the file the test ran. */
  ranges: [number, number][];
}

/** The coverage layer of one file: a `covered` entry per range a statement-validating test ran, relating back to that test file. */
export function buildCoverageIndex(
  path: string,
  tests: CoveringTestRanges[],
): SpecCodeIndex {
  const index: SpecCodeIndex = new Map();

  for (const entry of tests.flatMap(coveredEntries)) {
    addEntry(index, path, entry);
  }

  return index;
}

/** One `covered` entry per range the test ran, none for a test that validates no statement. */
function coveredEntries({
  testFile,
  statement,
  ranges,
}: CoveringTestRanges): RangeEntry[] {
  if (!statement) {
    return [];
  }
  const related = [{ label: basename(testFile), path: testFile, line: null }];

  return ranges.map(([startLine, endLine]) => ({
    startLine,
    endLine,
    layer: "covered",
    evidence: "execution-verified",
    statementText: statement.trim(),
    specPath: "",
    specLine: 0,
    related,
  }));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Merges with local precedence: drops a coverage entry when an inline entry already covers the same (statement, file). */
export function mergeIndexes(
  local: SpecCodeIndex,
  coverage: SpecCodeIndex,
): SpecCodeIndex {
  const merged: SpecCodeIndex = new Map();

  for (const [path, entries] of local) {
    merged.set(path, [...entries]);
  }

  for (const [path, entries] of coverage) {
    mergeCoverageEntries(merged, path, entries, local.get(path));
  }

  return merged;
}

/** Add the coverage entries not already stated inline for the same file. */
function mergeCoverageEntries(
  merged: SpecCodeIndex,
  path: string,
  entries: RangeEntry[],
  localEntries: RangeEntry[] | undefined,
): void {
  for (const entry of entries) {
    if (localEntries?.some((e) => e.statementText === entry.statementText)) {
      continue;
    }
    addEntry(merged, path, entry);
  }
}
