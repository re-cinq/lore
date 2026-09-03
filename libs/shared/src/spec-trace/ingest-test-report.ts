/** spec-traceability-graph Phase 6 (T260): consumes a project-test-interface test-report payload into TestChunk/TestSuite/Statement nodes, aggregating anchors per-statement (`Statement.violated` reflects any failing validator this report), and hands covered ranges to {@link ingestCoverageReport}. */

import type {
  CoveredChunk,
  DgraphClientPort,
  TestDescriptor,
  TaggedRunResult,
} from "./deps.js";
import { deletePredicate, upsertByXid, withTxn } from "./dgraph-upsert.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { parseSentenceLink, sentenceLinkFromSuite } from "./sentence-link.js";
import {
  resolveSentenceLink,
  type SentenceMatch,
} from "./resolve-sentence-link.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";
import { parseSpecAnchors } from "./spec-anchor.js";

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

/** Accumulated state for one Statement across all descriptors in a report. */
interface StatementGroup {
  xid: string;
  validatingChunkUids: string[];
  failingTestNames: string[];
}

/** A descriptor paired with its own per-`it` TestChunk uid and the file-scoped TestChunk uid that owns coverage (`validated_by` targets the latter). */
interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
  fileChunkUid: string;
}

/** Pure data-shaping: folds spec-anchored descriptors into one {@link StatementGroup} per Statement xid, collecting validating TestChunk uids + failing test names. No Dgraph I/O. */
function groupStatementsByAnchor(
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TaggedRunResult>,
): StatementGroup[] {
  const groups = new Map<string, StatementGroup>();

  for (const { descriptor, fileChunkUid } of entries) {
    // A descriptor may carry several anchors — contribute its TestChunk to every anchored statement.
    addDescriptorToAnchoredGroups(groups, repo, {
      descriptor,
      fileChunkUid,
      failed: resultById.get(descriptor.id)?.passed === false,
    });
  }

  return [...groups.values()];
}

function addDescriptorToAnchoredGroups(
  groups: Map<string, StatementGroup>,
  repo: string,
  entry: { descriptor: TestDescriptor; fileChunkUid: string; failed: boolean },
): void {
  for (const anchor of parseSpecAnchors(entry.descriptor.spec)) {
    const xid = `${repo}|${anchor.specPath}|${anchor.ordinal}`;
    const group = groups.get(xid) ?? {
      xid,
      validatingChunkUids: [],
      failingTestNames: [],
    };

    group.validatingChunkUids.push(entry.fileChunkUid);

    if (entry.failed) {
      group.failingTestNames.push(entry.descriptor.name);
    }
    groups.set(xid, group);
  }
}

/** Writes one aggregated Statement upsert per group; `violation_reason` is cleared by deleting the predicate on recovery, never by writing `""` (Dgraph corrupts an empty scalar into `"[]"`). */
async function writeStatementGroup(
  dgraph: DgraphClientPort,
  group: StatementGroup,
): Promise<boolean> {
  const failed = group.failingTestNames.length > 0;
  const statementUid = await upsertByXid(dgraph, "Statement", group.xid, {
    "Statement.validated_by": group.validatingChunkUids.map((uid) => ({ uid })),
    "Statement.violated": failed,
    ...(failed
      ? {
          "Statement.violation_reason": `validating test failed: ${group.failingTestNames.join(", ")}`,
        }
      : {}),
  });

  if (!failed) {
    await deletePredicate(dgraph, statementUid, "Statement.violation_reason");
  }

  return failed;
}

/** A sentence-resolved match node with the validating chunks + failing tests aggregated onto it. */
interface SentenceGroup extends SentenceMatch {
  validatingChunkUids: string[];
  failingTestNames: string[];
}

/** Resolves anchorless descriptors that sentence-match a Statement/AcceptanceCriterion, aggregating validating TestChunks per resolved node. Mirrors {@link groupStatementsByAnchor}, keyed by the resolver's live node uid. */
async function groupStatementsBySentence(
  dgraph: DgraphClientPort,
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TaggedRunResult>,
): Promise<SentenceGroup[]> {
  const groups = new Map<string, SentenceGroup>();

  for (const { descriptor, fileChunkUid } of entries) {
    if (parseSpecAnchors(descriptor.spec).length > 0) {
      continue;
    }
    // Structural (describe-nesting) link is primary; falls back to a hand-written name for backward compatibility.
    const link =
      sentenceLinkFromSuite(descriptor) ?? parseSentenceLink(descriptor.name);

    if (!link) {
      continue;
    }

    addDescriptorToSentenceGroups(groups, {
      matches: await resolveSentenceLink(dgraph, repo, link),
      descriptor,
      fileChunkUid,
      failed: resultById.get(descriptor.id)?.passed === false,
    });
  }

  return [...groups.values()];
}

function addDescriptorToSentenceGroups(
  groups: Map<string, SentenceGroup>,
  entry: {
    matches: SentenceMatch[];
    descriptor: TestDescriptor;
    fileChunkUid: string;
    failed: boolean;
  },
): void {
  for (const match of entry.matches) {
    const group = groups.get(match.uid) ?? {
      ...match,
      validatingChunkUids: [],
      failingTestNames: [],
    };

    group.validatingChunkUids.push(entry.fileChunkUid);

    if (entry.failed) {
      group.failingTestNames.push(entry.descriptor.name);
    }
    groups.set(match.uid, group);
  }
}

/** Writes a sentence-resolved group onto its existing node by uid, same violated/violation_reason handling as {@link writeStatementGroup}. */
async function writeSentenceGroup(
  dgraph: DgraphClientPort,
  group: SentenceGroup,
): Promise<boolean> {
  const failed = group.failingTestNames.length > 0;

  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid: group.uid,
        [`${group.nodeType}.validated_by`]: group.validatingChunkUids.map(
          (uid) => ({ uid }),
        ),
        [`${group.nodeType}.violated`]: failed,
        ...(failed
          ? {
              [`${group.nodeType}.violation_reason`]: `validating test failed: ${group.failingTestNames.join(", ")}`,
            }
          : {}),
      },
      commitNow: true,
    }),
  );

  if (!failed) {
    await deletePredicate(
      dgraph,
      group.uid,
      `${group.nodeType}.violation_reason`,
    );
  }

  return failed;
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

export async function ingestTestReport(
  dgraph: DgraphClientPort,
  repo: string,
  report: TestReport,
): Promise<IngestTestReportResult> {
  let violated = 0;
  const resultById = new Map(
    report.results.map((result) => [result.id, result]),
  );
  const entries: DescriptorChunk[] = [];
  const fileChunkUidByFile = new Map<string, string>();
  const repoTestChunkUids = new Set<string>();
  const repoSuiteUids = new Set<string>();

  for (const descriptor of report.tests) {
    const innermostSuiteUid = await projectSuiteChain(dgraph, repo, descriptor);

    if (innermostSuiteUid) {
      repoSuiteUids.add(innermostSuiteUid);
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
    let fileChunkUid = fileChunkUidByFile.get(descriptor.file);

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
      fileChunkUidByFile.set(descriptor.file, fileChunkUid);
    }
    repoTestChunkUids.add(testChunkUid).add(fileChunkUid);
    entries.push({ descriptor, testChunkUid, fileChunkUid });
  }

  // Attach every TestChunk + leaf TestSuite to the Repo root so the test layer is reachable; set-union dedups across re-ingests.
  await upsertByXid(dgraph, "Repo", repo, {
    ...(repoTestChunkUids.size
      ? { "Repo.test_chunks": [...repoTestChunkUids].map((uid) => ({ uid })) }
      : {}),
    ...(repoSuiteUids.size
      ? { "Repo.test_suites": [...repoSuiteUids].map((uid) => ({ uid })) }
      : {}),
  });

  const statementGroups = groupStatementsByAnchor(repo, entries, resultById);

  for (const group of statementGroups) {
    if (await writeStatementGroup(dgraph, group)) {
      violated += 1;
    }
  }
  const sentenceGroups = await groupStatementsBySentence(
    dgraph,
    repo,
    entries,
    resultById,
  );

  for (const group of sentenceGroups) {
    if (await writeSentenceGroup(dgraph, group)) {
      violated += 1;
    }
  }
  const validatedBy = statementGroups.length + sentenceGroups.length;

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
