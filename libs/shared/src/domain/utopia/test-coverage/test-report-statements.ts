// One test run as Utopia statement items: one item per test, keyed on the test's anchor hash (Repository contains SourceFile contains Test), each with the test's attributes, the statements it validates or violates, and the definitions it covers, split across `#hash.2`, `#hash.3` when its covered files overflow Utopia's push limits.

import { anchorHashOf } from "../../anchor-hash.js";
import { parseSpecAnchors } from "../../spec-trace/spec-anchor.js";
import type {
  CoveredChunk,
  TaggedRunResult,
  TestDescriptor,
} from "../../test-report.js";
import { joinFragments, splitToFit, type Fragment } from "../fragments.js";
import {
  blobUrl,
  definitionName,
  fileName,
  statementName,
  testName,
} from "../names.js";
import {
  attribute,
  knownAs,
  relation,
  sourceFileStatements,
  type Statement,
  type StatementItem,
} from "../statements.js";

export interface TestReportInput {
  repo: string;
  tests: TestDescriptor[];
  results: TaggedRunResult[];
  /** The definitions of each covered file by path, as the code graph holds them: a covered range is named by the definition it ran, never by its lines. */
  definitions?: ReadonlyMap<string, readonly CodeSpan[]>;
}

/** One definition of a source file and the lines it spans. */
export interface CodeSpan {
  symbol: string;
  start: number;
  end: number;
}

interface LineRange {
  start: number;
  end: number;
}

/** One test file of a report, its items built only when asked, so a mirror can hold one file's items at a time. */
export interface TestFileItems {
  /** `test:<path>`, the id of the file's first item. */
  key: string;
  items(): StatementItem[];
}

export function testReportItems(input: TestReportInput): StatementItem[] {
  return testReportFiles(input).flatMap((file) => file.items());
}

export function testReportFiles(input: TestReportInput): TestFileItems[] {
  const resultById = new Map(
    input.results.map((result) => [result.id, result]),
  );

  return [...testsByFile(input.tests)].map(([path, tests]) => ({
    key: `test:${path}`,
    items: () =>
      [...testsByHash(tests)].flatMap((group) =>
        testItems(input, path, group, resultById),
      ),
  }));
}

function testsByFile(tests: TestDescriptor[]): Map<string, TestDescriptor[]> {
  const byFile = new Map<string, TestDescriptor[]>();

  for (const test of tests) {
    byFile.set(test.file, [...(byFile.get(test.file) ?? []), test]);
  }

  return byFile;
}

/** The descriptors of one file by anchor hash: several share one when it.each rows declare on one line. */
function testsByHash(tests: TestDescriptor[]): TestDescriptor[][] {
  const byHash = new Map<string, TestDescriptor[]>();

  for (const test of tests) {
    const hash = hashOf(test);

    byHash.set(hash, [...(byHash.get(hash) ?? []), test]);
  }

  return [...byHash.values()];
}

/** The descriptor's own anchor hash, else the hash of its title, else its first line: what names the item when the producer read no line. */
function hashOf(descriptor: TestDescriptor): string {
  return (
    descriptor.anchorHash ??
    anchorHashOf(titleOf(descriptor)) ??
    `l${descriptor.startLine ?? 0}`
  );
}

/** One test's items: its head and attributes in every item, the files it covers packed after them; a test that covers hundreds of files spans `#hash`, `#hash.2`, … instead of overflowing one. */
function testItems(
  input: TestReportInput,
  path: string,
  group: TestDescriptor[],
  resultById: Map<string, TaggedRunResult>,
): StatementItem[] {
  const test = testName(input.repo, path, titleOf(group[0]));
  const results = group.flatMap((descriptor) => {
    const result = resultById.get(descriptor.id);

    return result ? [result] : [];
  });
  const head = testHead(input, path, group, results);
  const covered = results.flatMap((result) => result.covered ?? []);

  return splitToFit(
    `test:${path}#${hashOf(group[0])}`,
    coverParts(input, test, covered),
    (part) => joinFragments(head, part),
  );
}

/** The file's head, the first descriptor's attributes, the other descriptors' titles as known_as, and the group's outcome when any member ran. */
function testHead(
  input: TestReportInput,
  path: string,
  [first, ...rest]: TestDescriptor[],
  results: TaggedRunResult[],
): Fragment {
  const title = titleOf(first);
  const test = testName(input.repo, path, title);

  return joinFragments(fileHead(input.repo, path), [
    testAttributes(input, first, test, title),
    { e: [], s: rest.map((descriptor) => knownAs(test, titleOf(descriptor))) },
    ...(results.length === 0
      ? []
      : [outcomeFragment(input.repo, test, first, groupOutcome(results))]),
  ]);
}

/** Failed when any member failed, passed when every member with a result passed. */
function groupOutcome(results: TaggedRunResult[]): TaggedRunResult {
  return {
    id: results[0].id,
    passed: results.every((result) => result.passed),
    covered: null,
  };
}

function fileHead(repo: string, path: string): Fragment {
  const file = fileName(repo, path);

  return {
    e: [
      [repo, "Repository", true],
      [file, "SourceFile", true],
    ],
    s: [relation(repo, "contains", file), ...sourceFileStatements(file, path)],
  };
}

function testAttributes(
  input: TestReportInput,
  descriptor: TestDescriptor,
  test: string,
  title: string,
): Fragment {
  return {
    e: [[test, "Test", true]],
    s: [
      relation(fileName(input.repo, descriptor.file), "contains", test),
      attribute(test, "title", title),
      knownAs(test, title),
      attribute(test, "path", descriptor.file),
      ...anchorAttribute(test, descriptor),
      attribute(test, "permalink", `${blobUrl(input.repo)}/${descriptor.file}`),
    ],
  };
}

/** The title as written in the it() call: a runner that names a test by its describe chain joins it with ` > ` and lists the chain as `suite`, and spec links are labelled with the title alone. */
function titleOf(descriptor: TestDescriptor): string {
  const chain = (descriptor.suite ?? []).map((name) => `${name} > `).join("");

  return descriptor.name.startsWith(chain)
    ? descriptor.name.slice(chain.length)
    : descriptor.name;
}

/** The anchor hash names the test wherever it stands; its lines are left out, since a line added above it would change the item and Utopia would re-extract it. */
function anchorAttribute(
  test: string,
  descriptor: TestDescriptor,
): Statement[] {
  return descriptor.anchorHash === undefined
    ? []
    : [attribute(test, "anchor_hash", descriptor.anchorHash)];
}

function outcomeFragment(
  repo: string,
  test: string,
  descriptor: TestDescriptor,
  result: TaggedRunResult,
): Fragment {
  const statements = parseSpecAnchors(descriptor.spec).map((anchor) =>
    statementName(repo, anchor.specPath, anchor.ordinal),
  );
  const phrase = result.passed ? "validated_by" : "violated_by";

  return {
    e: statements.map((statement) => [statement, "Statement", true]),
    s: [
      attribute(test, "outcome", result.passed ? "passed" : "failed"),
      ...statements.map((statement) => relation(statement, phrase, test)),
    ],
  };
}

/** One part per covered definition, and one for the file when a covered range lies outside every definition the file is known to have. No line reaches the push: an edit that only moves lines leaves the item as it was. */
function coverParts(
  input: TestReportInput,
  test: string,
  covered: CoveredChunk[],
): Fragment[] {
  return [...rangesByFile(covered)].flatMap(([path, ranges]) => {
    const file = fileName(input.repo, path);
    const { symbols, outside } = coveredSymbols(
      input.definitions?.get(path) ?? [],
      ranges,
    );
    const definitions = symbols.map((symbol) =>
      definitionCover(test, file, definitionName(input.repo, path, symbol)),
    );

    return outside ? [fileCover(test, file), ...definitions] : definitions;
  });
}

function definitionCover(
  test: string,
  file: string,
  definition: string,
): Fragment {
  return {
    e: [
      [file, "SourceFile", true],
      [definition, "CodeDefinition", true],
    ],
    s: [
      relation(file, "defines", definition),
      relation(test, "covers", definition),
    ],
  };
}

function fileCover(test: string, file: string): Fragment {
  return {
    e: [[file, "SourceFile", true]],
    s: [relation(test, "covers", file)],
  };
}

/** The innermost definitions the ranges overlap, sorted by symbol, and whether some range overlaps none. */
function coveredSymbols(
  definitions: readonly CodeSpan[],
  ranges: LineRange[],
): { symbols: string[]; outside: boolean } {
  const perRange = ranges.map((range) => innermostAt(definitions, range));
  const symbols = perRange.flat().map((definition) => definition.symbol);

  return {
    symbols: [...new Set(symbols)].sort(),
    outside: perRange.some((innermost) => innermost.length === 0),
  };
}

/** The definitions overlapping the range that hold no other overlapping one: a method, not the class around it. */
function innermostAt(
  definitions: readonly CodeSpan[],
  range: LineRange,
): CodeSpan[] {
  const overlapping = definitions.filter(
    (definition) =>
      definition.start <= range.end && definition.end >= range.start,
  );
  const holdsAnother = (outer: CodeSpan) =>
    overlapping.some(
      (inner) =>
        inner !== outer && inner.start >= outer.start && inner.end <= outer.end,
    );

  return overlapping.filter((definition) => !holdsAnother(definition));
}

/** Each file's covered ranges sorted by path and line, with overlapping and adjacent ranges merged into one. */
function rangesByFile(covered: CoveredChunk[]): Map<string, LineRange[]> {
  const sorted = [...covered].sort(
    (a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine,
  );
  const byFile = new Map<string, LineRange[]>();

  for (const chunk of sorted) {
    const ranges = byFile.get(chunk.file) ?? [];
    const last = ranges.at(-1);

    byFile.set(
      chunk.file,
      last && chunk.startLine <= last.end + 1
        ? [
            ...ranges.slice(0, -1),
            { start: last.start, end: Math.max(last.end, chunk.endLine) },
          ]
        : [...ranges, { start: chunk.startLine, end: chunk.endLine }],
    );
  }

  return byFile;
}
