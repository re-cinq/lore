/** The covered code of one test file, from the istanbul JSON coverage map vitest's v8 provider produces: what the project-test-interface's `run` prints as `covered`. */
import type { CoveredChunk } from "../test-report.js";

/** Covered code we keep: any traceability package's src. A test may cover code in its own package; another package's src is captured only when the coverage reports it. */
const SRC_RE = /^(?:libs|apps)\/[^/]+\/src\//;

/** The test files themselves: COVERS targets real code, not the test. */
const TEST_FILE_RE = /\.test\.tsx?$/;

interface StatementRange {
  start: { line: number };
  end: { line?: number | null };
}

/** One file's entry in an istanbul `coverage-final.json`. */
export interface FileCoverage {
  path: string;
  statementMap: Record<string, StatementRange>;
  s: Record<string, number>;
}

/** Every statement that ran, as a repo-relative `{file, startLine, endLine}` range, each range once. */
export function coveredRanges(
  report: Record<string, FileCoverage>,
  root: string,
): CoveredChunk[] {
  const ranges = Object.values(report)
    .map((entry) => ({ file: repoRelative(entry.path, root), entry }))
    .filter(({ file }) => SRC_RE.test(file) && !TEST_FILE_RE.test(file))
    .flatMap(({ file, entry }) => statementsThatRan(file, entry));

  return [
    ...new Map(
      ranges.map((range) => [
        `${range.file}:${range.startLine}:${range.endLine}`,
        range,
      ]),
    ).values(),
  ];
}

function repoRelative(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function statementsThatRan(file: string, entry: FileCoverage): CoveredChunk[] {
  return Object.entries(entry.statementMap)
    .filter(([statementId]) => (entry.s[statementId] ?? 0) > 0)
    .map(([, range]) => ({
      file,
      startLine: range.start.line,
      endLine: range.end.line ?? range.start.line,
    }));
}
