// One test run as Utopia statement items: one item per test file (Repository contains SourceFile contains Test), each test with its attributes, the statements it validates or violates, and the lines it covers, each under Utopia's push limits.

import { parseSpecAnchors } from "../../spec-trace/spec-anchor.js";
import type {
  CoveredChunk,
  TaggedRunResult,
  TestDescriptor,
} from "../../test-report.js";
import { joinFragments, splitToFit, type Fragment } from "../fragments.js";
import { blobUrl, fileName, statementName, testName } from "../names.js";
import {
  attribute,
  relation,
  tombstone,
  type Statement,
  type StatementItem,
  type Tombstone,
} from "../statements.js";

export interface TestReportInput {
  repo: string;
  tests: TestDescriptor[];
  results: TaggedRunResult[];
}

interface LineRange {
  start: number;
  end: number;
}

export function testReportItems(input: TestReportInput): StatementItem[] {
  const resultById = new Map(
    input.results.map((result) => [result.id, result]),
  );

  return [...testsByFile(input.tests)].flatMap(([path, tests]) =>
    splitToFit(
      `test:${path}`,
      tests.map((test) => testFragment(input, test, resultById.get(test.id))),
      (part) => joinFragments(fileHead(input.repo, path), part),
    ),
  );
}

export function testFileTombstones(paths: string[]): Tombstone[] {
  return paths.map((path) => tombstone(`test:${path}`));
}

function testsByFile(tests: TestDescriptor[]): Map<string, TestDescriptor[]> {
  const byFile = new Map<string, TestDescriptor[]>();

  for (const test of tests) {
    byFile.set(test.file, [...(byFile.get(test.file) ?? []), test]);
  }

  return byFile;
}

function fileHead(repo: string, path: string): Fragment {
  const file = fileName(repo, path);

  return {
    e: [
      [repo, "Repository", true],
      [file, "SourceFile", true],
    ],
    s: [relation(repo, "contains", file), attribute(file, "path", path)],
  };
}

function testFragment(
  input: TestReportInput,
  descriptor: TestDescriptor,
  result: TaggedRunResult | undefined,
): Fragment {
  const title = titleOf(descriptor);
  const test = testName(input.repo, descriptor.file, title);
  const runParts = result
    ? [
        outcomeFragment(input.repo, test, descriptor, result),
        ...coverageFragments(input, test, result.covered ?? []),
      ]
    : [];

  return joinFragments(
    testAttributes(input, descriptor, test, title),
    runParts,
  );
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
      attribute(test, "path", descriptor.file),
      ...lineAttributes(test, descriptor),
      attribute(test, "permalink", permalinkOf(input, descriptor)),
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

function lineAttributes(test: string, descriptor: TestDescriptor): Statement[] {
  return [
    ...(descriptor.startLine === undefined
      ? []
      : [attribute(test, "line_start", String(descriptor.startLine))]),
    ...(descriptor.endLine === undefined
      ? []
      : [attribute(test, "line_end", String(descriptor.endLine))]),
  ];
}

function permalinkOf(
  input: TestReportInput,
  descriptor: TestDescriptor,
): string {
  const { startLine, endLine } = descriptor;
  const end = endLine === undefined ? "" : `-L${endLine}`;
  const anchor = startLine === undefined ? "" : `#L${startLine}${end}`;

  return `${blobUrl(input.repo)}/${descriptor.file}${anchor}`;
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

function coverageFragments(
  input: TestReportInput,
  test: string,
  covered: CoveredChunk[],
): Fragment[] {
  return [...rangesByFile(covered)].map(([path, ranges]) => {
    const file = fileName(input.repo, path);
    const lines = ranges.map(({ start, end }) => `${start}-${end}`).join(",");

    return {
      e: [[file, "SourceFile", true]],
      s: [
        relation(test, "covers", file, { lines }),
        attribute(file, "path", path),
      ],
    };
  });
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
