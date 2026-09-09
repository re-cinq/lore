/** spec-traceability-graph Phase 6 (T260): consumes a project-test-interface test-report payload into TestChunk/TestSuite/Statement nodes, aggregating anchors per-statement (`Statement.violated` reflects any failing validator this report), and hands covered ranges to {@link ingestCoverageReport}. */

import type {
  CoveredChunk,
  DgraphClientPort,
  TestDescriptor,
  TaggedRunResult,
} from "../../outbound/spec-trace/deps.js";
import {
  isOverlay,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import {
  projectDescriptors,
  type DescriptorChunk,
} from "./ingest-test-report-chunks.js";
import {
  groupStatementsByAnchor,
  groupStatementsBySentence,
  writeSentenceGroup,
  writeStatementGroup,
} from "./ingest-test-report-groups.js";

export type { DescriptorChunk };

/** A coverage record as {@link ingestCoverageReport} consumes it. */
interface CoverageRecord {
  testFile: string;
  testName: string;
  covered: CoveredChunk[];
}

export interface TestReport {
  commit?: string;
  branch?: string;
  /** The assembly run whose branch this report describes; its presence is what routes the ingest into an overlay. */
  assemblyRunId?: string;
  tests: TestDescriptor[];
  results: TaggedRunResult[];
}

export interface IngestTestReportResult {
  testChunks: number;
  validatedBy: number;
  coverageNodes: number;
  coversEdges: number;
  violated: number;
}

/** No spec links from an overlay. A Statement belongs to `main` — the branch is measured AGAINST it — so writing `validated_by` from a branch test would let an unmerged run change what main claims to have proved. */
const NO_SPEC_LINKS = { validatedBy: 0, violated: 0 };

export async function ingestTestReport(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  report: TestReport,
): Promise<IngestTestReportResult> {
  const entries = await projectDescriptors(dgraph, scope, report.tests);
  const links = await specLinksFor(dgraph, scope, entries, report);
  const cov = await ingestReportCoverage(dgraph, scope, report);

  return {
    testChunks: report.tests.length,
    validatedBy: links.validatedBy,
    coverageNodes: cov.coverageNodes,
    coversEdges: cov.coversEdges,
    violated: links.violated,
  };
}

/** The spec links this report justifies, or none at all when it describes a branch. */
async function specLinksFor(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  entries: DescriptorChunk[],
  report: TestReport,
): Promise<{ validatedBy: number; violated: number }> {
  if (isOverlay(scope)) {
    return NO_SPEC_LINKS;
  }
  const resultById = new Map(
    report.results.map((result) => [result.id, result]),
  );

  return writeSpecLinks(dgraph, scope.repo, entries, resultById);
}

/** The spec links a run of the suite justifies, grouped two ways because a test can name its statement by ANCHOR (an explicit id) or by SENTENCE (the statement's own text). Both produce the same edge; only the addressing differs. */
async function writeSpecLinks(
  dgraph: DgraphClientPort,
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TestReport["results"][number]>,
): Promise<{ validatedBy: number; violated: number }> {
  const statements = groupStatementsByAnchor(repo, entries, resultById);
  const sentences = await groupStatementsBySentence(
    dgraph,
    repo,
    entries,
    resultById,
  );

  return {
    validatedBy: statements.length + sentences.length,
    violated: await countViolations(dgraph, { statements, sentences }),
  };
}

/** How many groups came back violated, across both addressings. A group whose tests failed writes `violated` instead of `validated_by` — a red test is evidence AGAINST the statement, and recording it as validation is how a spec comes to claim coverage it does not have. */
async function countViolations(
  dgraph: DgraphClientPort,
  groups: {
    statements: ReturnType<typeof groupStatementsByAnchor>;
    sentences: Awaited<ReturnType<typeof groupStatementsBySentence>>;
  },
): Promise<number> {
  const statements = await writeGroupsCountingViolations(
    groups.statements,
    (group) => writeStatementGroup(dgraph, group),
  );
  const sentences = await writeGroupsCountingViolations(
    groups.sentences,
    (group) => writeSentenceGroup(dgraph, group),
  );

  return statements + sentences;
}

/** Writes every group via `writeGroup`, returning how many of them came back violated. */
async function writeGroupsCountingViolations<T>(
  groups: T[],
  writeGroup: (group: T) => Promise<boolean>,
): Promise<number> {
  let violated = 0;

  for (const group of groups) {
    if (await writeGroup(group)) {
      violated += 1;
    }
  }

  return violated;
}

/** Hands this report's covered ranges to the coverage ingest, tagged with the tool that produced them. */
async function ingestReportCoverage(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  report: TestReport,
) {
  return ingestCoverageReport(
    dgraph,
    { scope, tool: "test-interface", commit: report.commit ?? "" },
    coverageRecordsFor(report),
  );
}

function coverageRecordsFor(report: TestReport): CoverageRecord[] {
  return [...coveredRangesByFile(report)].map(([file, ranges]) => ({
    testFile: file,
    testName: file,
    covered: [...ranges.values()],
  }));
}

/** Joins run results to their descriptors and merges covered ranges per test FILE (coverage is file-level), so a Coverage node attaches to the file-scoped TestChunk. */
function coveredRangesByFile(
  report: TestReport,
): Map<string, Map<string, CoveredChunk>> {
  const descriptorById = new Map(
    report.tests.map((descriptor) => [descriptor.id, descriptor]),
  );
  const byFile = new Map<string, Map<string, CoveredChunk>>();

  for (const result of report.results) {
    const descriptor = descriptorById.get(result.id);

    if (!descriptor) {
      continue;
    }
    const ranges =
      byFile.get(descriptor.file) ??
      byFile.set(descriptor.file, new Map()).get(descriptor.file)!;

    recordCoveredRanges(ranges, result.covered);
  }

  return byFile;
}

/** Folds covered ranges into the file's range map, keyed by position so a range reported by several tests is stored once. */
function recordCoveredRanges(
  ranges: Map<string, CoveredChunk>,
  covered: CoveredChunk[],
): void {
  for (const chunk of covered) {
    ranges.set(`${chunk.file}:${chunk.startLine}:${chunk.endLine}`, chunk);
  }
}
