/** spec-traceability-graph Phase 6 (T260): consumes a project-test-interface test-report payload into TestChunk/TestSuite/Statement nodes, aggregating anchors per-statement (`Statement.violated` reflects any failing validator this report), and hands covered ranges to {@link ingestCoverageReport}. */

import type {
  CoveredChunk,
  DgraphClientPort,
  TestDescriptor,
  TaggedRunResult,
} from "./deps.js";
import { upsertByXid } from "./dgraph-upsert.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";
import {
  groupStatementsByAnchor,
  groupStatementsBySentence,
  writeSentenceGroup,
  writeStatementGroup,
} from "./ingest-test-report-groups.js";

/** A coverage record as {@link ingestCoverageReport} consumes it. */
interface CoverageRecord {
  testFile: string;
  testName: string;
  covered: CoveredChunk[];
}

/** Joins run results to their descriptors and merges covered ranges into one record per FILE (coverage is file-level), so its Coverage node attaches to the file-scoped TestChunk. */
function recordCoveredRanges(
  ranges: Map<string, CoveredChunk>,
  covered: CoveredChunk[],
): void {
  for (const chunk of covered) {
    ranges.set(`${chunk.file}:${chunk.startLine}:${chunk.endLine}`, chunk);
  }
}

function coverageRecordsFor(report: TestReport): CoverageRecord[] {
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

  return [...byFile].map(([file, ranges]) => ({
    testFile: file,
    testName: file,
    covered: [...ranges.values()],
  }));
}

export interface TestReport {
  commit?: string;
  branch?: string;
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

/** A descriptor paired with its own per-`it` TestChunk uid and the file-scoped TestChunk uid that owns coverage (`validated_by` targets the latter). */
export interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
  fileChunkUid: string;
}

/** Projects the descriptor's suite chain as a parent-linked spine of TestSuite nodes, returning the innermost uid; undefined when the descriptor has no suite. */
async function projectSuiteChain(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
): Promise<string | undefined> {
  if (!descriptor.suite?.length) {
    return undefined;
  }
  let parentUid: string | undefined;

  for (let i = 0; i < descriptor.suite.length; i += 1) {
    const suiteChain = descriptor.suite.slice(0, i + 1).join(">");

    parentUid = await upsertByXid(
      dgraph,
      "TestSuite",
      `${repo}|${descriptor.file}|${suiteChain}`,
      {
        "TestSuite.repo": repo,
        "TestSuite.name": descriptor.suite[i],
        "TestSuite.file_path": descriptor.file,
        ...(parentUid ? { "TestSuite.parent": { uid: parentUid } } : {}),
      },
    );
  }

  return parentUid;
}

/** Per-report accumulators an ingested descriptor folds into: the file-scoped TestChunk cache plus the Repo-root edge sets. */
interface DescriptorIngestState {
  fileChunkUidByFile: Map<string, string>;
  repoTestChunkUids: Set<string>;
  repoSuiteUids: Set<string>;
}

/** Upserts one descriptor's per-`it` + file-scoped TestChunks (caching the latter per file) and folds both into the Repo-root edge sets. */
async function ingestDescriptorChunk(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
  state: DescriptorIngestState,
): Promise<DescriptorChunk> {
  const innermostSuiteUid = await projectSuiteChain(dgraph, repo, descriptor);

  if (innermostSuiteUid) {
    state.repoSuiteUids.add(innermostSuiteUid);
  }
  const testChunkUid = await upsertByXid(
    dgraph,
    "TestChunk",
    `${repo}|${descriptor.id}`,
    {
      "TestChunk.repo": repo,
      "TestChunk.test_name": descriptor.name,
      "TestChunk.file_path": descriptor.file,
      ...(descriptor.startLine !== undefined
        ? { "TestChunk.start_line": descriptor.startLine }
        : {}),
      ...(descriptor.endLine !== undefined
        ? { "TestChunk.end_line": descriptor.endLine }
        : {}),
      ...(innermostSuiteUid
        ? { "TestChunk.suite": { uid: innermostSuiteUid } }
        : {}),
    },
  );
  // The file-scoped TestChunk that owns coverage — `validated_by` targets this so the chain reconverges.
  let fileChunkUid = state.fileChunkUidByFile.get(descriptor.file);

  if (fileChunkUid === undefined) {
    fileChunkUid = await upsertByXid(
      dgraph,
      "TestChunk",
      fileScopedTestChunkXid(repo, descriptor.file),
      {
        "TestChunk.repo": repo,
        "TestChunk.file_path": descriptor.file,
        // test_name = file so the file-level coverage record attaches HAS_COVERAGE to this same node.
        "TestChunk.test_name": descriptor.file,
      },
    );
    state.fileChunkUidByFile.set(descriptor.file, fileChunkUid);
  }
  state.repoTestChunkUids.add(testChunkUid).add(fileChunkUid);

  return { descriptor, testChunkUid, fileChunkUid };
}

/** Attach every TestChunk + leaf TestSuite to the Repo root so the test layer is reachable; set-union dedups across re-ingests. */
async function attachTestLayerToRepo(
  dgraph: DgraphClientPort,
  repo: string,
  state: DescriptorIngestState,
): Promise<void> {
  await upsertByXid(dgraph, "Repo", repo, {
    ...(state.repoTestChunkUids.size
      ? {
          "Repo.test_chunks": [...state.repoTestChunkUids].map((uid) => ({
            uid,
          })),
        }
      : {}),
    ...(state.repoSuiteUids.size
      ? {
          "Repo.test_suites": [...state.repoSuiteUids].map((uid) => ({
            uid,
          })),
        }
      : {}),
  });
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

export async function ingestTestReport(
  dgraph: DgraphClientPort,
  repo: string,
  report: TestReport,
): Promise<IngestTestReportResult> {
  const resultById = new Map(
    report.results.map((result) => [result.id, result]),
  );
  const state: DescriptorIngestState = {
    fileChunkUidByFile: new Map(),
    repoTestChunkUids: new Set(),
    repoSuiteUids: new Set(),
  };
  const entries: DescriptorChunk[] = [];

  for (const descriptor of report.tests) {
    entries.push(await ingestDescriptorChunk(dgraph, repo, descriptor, state));
  }
  await attachTestLayerToRepo(dgraph, repo, state);

  const statementGroups = groupStatementsByAnchor(repo, entries, resultById);
  const sentenceGroups = await groupStatementsBySentence(
    dgraph,
    repo,
    entries,
    resultById,
  );
  const validatedBy = statementGroups.length + sentenceGroups.length;
  const violated =
    (await writeGroupsCountingViolations(statementGroups, (group) =>
      writeStatementGroup(dgraph, group),
    )) +
    (await writeGroupsCountingViolations(sentenceGroups, (group) =>
      writeSentenceGroup(dgraph, group),
    ));

  const cov = await ingestCoverageReport(
    dgraph,
    { repo, tool: "test-interface", commit: report.commit ?? "" },
    coverageRecordsFor(report),
  );

  return {
    testChunks: report.tests.length,
    validatedBy,
    coverageNodes: cov.coverageNodes,
    coversEdges: cov.coversEdges,
    violated,
  };
}
