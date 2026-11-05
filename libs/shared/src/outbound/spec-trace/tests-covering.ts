/** `tests_covering(file, range)` (issue #1770): which tests exercise a span, so a round that goes red can tell the test it just wrote from a regression it just caused. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import {
  isOverlay,
  mainScope,
  overlayScope,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import {
  parseRanges,
  intervalsOverlap,
} from "../../domain/spec-trace/line-range.js";

/** One test file whose run exercises the asked-about span, and which scope answered for it. Coverage is aggregated per test FILE at ingest, so this names a file rather than one `it()`. */
export interface CoveringTest {
  testFile: string;
  /** The spec statement the file's tests validate, when one is declared; absent from an overlay, which writes no statement edges. */
  statement?: string;
  origin: "main" | "overlay";
  /** The 1-based inclusive line ranges of the asked-about file the test file's tests ran. */
  ranges: [number, number][];
}

/** What the caller wants covered: one file, optionally narrowed to line ranges. */
export interface CoverageTarget {
  file: string;
  ranges?: [number, number][];
}

interface GraphTestChunk {
  "TestChunk.file_path"?: string;
  stmts?: { "Statement.text"?: string }[];
}

interface GraphCoverage {
  file?: { "file|ranges"?: string }[];
  tc?: GraphTestChunk[];
}

const COVERING_QUERY = `query q($repo: string, $fp: string) {
  covs(func: eq(Coverage.repo, $repo)) {
    file: Coverage.covers @facets(ranges) @filter(eq(File.path, $fp)) { File.path }
    tc: ~TestChunk.coverage {
      TestChunk.file_path
      stmts: ~Statement.validated_by { Statement.text }
    }
  }
}`;

/** The tests covering `target` within ONE scope — main's own answer, or a run's branch answer. */
export async function testsCoveringInScope(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  target: CoverageTarget,
): Promise<CoveringTest[]> {
  const covs = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(COVERING_QUERY, {
      $repo: scope.key,
      $fp: target.file,
    });

    return (res.data.covs ?? []) as GraphCoverage[];
  });
  const origin = isOverlay(scope) ? "overlay" : "main";

  return dedupe(
    covs
      .filter((cov) => coversTarget(cov, target))
      .flatMap((cov) => coveringTestsOf(cov, origin)),
  );
}

/** The test files of one coverage record, each carrying the record's ranges of the file. */
function coveringTestsOf(
  cov: GraphCoverage,
  origin: CoveringTest["origin"],
): CoveringTest[] {
  const ranges = coveredRanges(cov);

  return (cov.tc ?? []).map((tc) => toCoveringTest(tc, origin, ranges));
}

/** The overlay's answer REPLACES main's for a file the branch covers; a file the branch never touched falls through to main. */
export function preferOverlay(
  fromMain: CoveringTest[],
  fromOverlay: CoveringTest[],
): CoveringTest[] {
  return fromOverlay.length ? fromOverlay : fromMain;
}

/** The tests covering `target` as the branch sees them: its own coverage where it has any, main's everywhere else. */
export async function testsCovering(
  dgraph: DgraphClientPort,
  scope: { repo: string; branch?: string },
  target: CoverageTarget,
): Promise<CoveringTest[]> {
  const fromMain = await testsCoveringInScope(
    dgraph,
    mainScope(scope.repo),
    target,
  );

  if (!scope.branch) {
    return fromMain;
  }
  const branch = await testsCoveringInScope(
    dgraph,
    overlayScope(scope.repo, scope.branch),
    target,
  );

  return preferOverlay(fromMain, branch);
}

/** Whether this record touches the file at all, and within the asked-about ranges when the caller narrowed them. */
function coversTarget(cov: GraphCoverage, target: CoverageTarget): boolean {
  const covered = coveredRanges(cov);

  if (covered.length === 0) {
    return false;
  }

  if (!target.ranges?.length) {
    return true;
  }

  return covered.some(([cs, ce]) =>
    target.ranges!.some(([s, e]) => intervalsOverlap(cs, ce, s, e)),
  );
}

/** The intervals this coverage record claims in the asked-about file. */
function coveredRanges(cov: GraphCoverage): [number, number][] {
  const files = cov.file ?? [];

  return files.length ? parseRanges(files[0]["file|ranges"] ?? "") : [];
}

function toCoveringTest(
  chunk: GraphTestChunk,
  origin: CoveringTest["origin"],
  ranges: [number, number][],
): CoveringTest {
  const statement = firstStatementText(chunk.stmts);

  return {
    testFile: chunk["TestChunk.file_path"] ?? "",
    ...(statement ? { statement } : {}),
    origin,
    ranges,
  };
}

/** One entry per test file — several coverage records can name the same one — carrying the ranges of all of them. */
function dedupe(tests: CoveringTest[]): CoveringTest[] {
  const byFile = new Map<string, CoveringTest>();

  for (const test of tests) {
    const seen = byFile.get(test.testFile);

    byFile.set(
      test.testFile,
      seen ? { ...seen, ranges: [...seen.ranges, ...test.ranges] } : test,
    );
  }

  return [...byFile.values()];
}

/** The statement text of the first validating edge, or undefined when the chunk validates none. */
function firstStatementText(
  stmts: { "Statement.text"?: string }[] | undefined,
): string | undefined {
  const first = stmts?.at(0);

  return first?.["Statement.text"];
}
