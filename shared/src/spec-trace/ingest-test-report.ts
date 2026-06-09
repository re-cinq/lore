/**
 * spec-traceability-graph — Phase 6 (T260): consume the project-test-interface
 * POSTed test-report payload into the graph.
 *
 * Each TestDescriptor becomes one TestChunk keyed by `${repo}|${id}`, carrying
 * repo / test_name / file_path / start_line / end_line. Spec anchors are
 * aggregated PER REPORT, PER STATEMENT: every descriptor pointing at the same
 * `path#ordinal` is grouped, and the Statement is upserted exactly once with a
 * VALIDATED_BY edge to each validating TestChunk. `Statement.violated` is set to
 * whether ANY validating test in this report failed (a failing test wins over a
 * passing sibling), so a passing re-ingest clears a prior `true`, and a reason is
 * written only on failure. When the descriptor carries a
 * `suite` chain, that chain is
 * projected (outermost→innermost) as a parent-linked spine of TestSuite nodes and
 * the TestChunk gains a `TestChunk.suite` edge to the innermost suite. Each run
 * result is joined to its descriptor by id and the covered ranges are handed to
 * {@link ingestCoverageReport}, which writes the Coverage and COVERS facets; their
 * real counts flow back into the returned result.
 */

import type { CoveredChunk, DgraphClientPort, TestDescriptor, TaggedRunResult } from "./deps.js";
import { deletePredicate, upsertByXid } from "./dgraph-upsert.js";
import { ingestCoverageReport } from "./ingest-coverage.js";

/** A coverage record as {@link ingestCoverageReport} consumes it. */
interface CoverageRecord {
  testFile: string;
  testName: string;
  covered: CoveredChunk[];
}

/**
 * Joins each run result to its descriptor by id and projects the covered ranges
 * into {@link ingestCoverageReport}'s record shape. Results with no matching
 * descriptor are dropped.
 */
function coverageRecordsFor(report: TestReport): CoverageRecord[] {
  const descriptorById = new Map(report.tests.map((descriptor) => [descriptor.id, descriptor]));
  return report.results.flatMap((result) => {
    const descriptor = descriptorById.get(result.id);
    return descriptor ? [{ testFile: descriptor.file, testName: descriptor.name, covered: result.covered }] : [];
  });
}

/**
 * Parse a `path#ordinal` spec anchor (as carried on a TestDescriptor's `spec`).
 * Returns null for a missing anchor, a blank path, or a non-integer ordinal.
 */
export function parseSpecAnchor(spec: string | undefined): { specPath: string; ordinal: number } | null {
  if (!spec?.includes("#")) return null;
  const [specPath, ordinalStr] = spec.split("#");
  const ordinal = Number(ordinalStr);
  if (!specPath || !Number.isInteger(ordinal)) return null;
  return { specPath, ordinal };
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

/** A descriptor paired with the uid of the TestChunk already written for it. */
interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
}

/**
 * Pure data-shaping: folds the report's spec-anchored descriptors into one
 * {@link StatementGroup} per Statement xid (`${repo}|${specPath}|${ordinal}`).
 * Descriptors without a parseable spec anchor are skipped. Each group collects
 * every validating TestChunk uid and the names of the validating tests that
 * failed in this report (a failing test wins over a passing sibling). No Dgraph
 * I/O — the TestChunk uids are passed in already created.
 */
function groupStatementsByAnchor(
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TaggedRunResult>,
): StatementGroup[] {
  const groups = new Map<string, StatementGroup>();
  for (const { descriptor, testChunkUid } of entries) {
    const anchor = parseSpecAnchor(descriptor.spec);
    if (!anchor) continue;
    const xid = `${repo}|${anchor.specPath}|${anchor.ordinal}`;
    const group = groups.get(xid) ?? { xid, validatingChunkUids: [], failingTestNames: [] };
    group.validatingChunkUids.push(testChunkUid);
    if (resultById.get(descriptor.id)?.passed === false) group.failingTestNames.push(descriptor.name);
    groups.set(xid, group);
  }
  return [...groups.values()];
}

/**
 * Writes one aggregated Statement upsert per group: a `Statement.validated_by`
 * edge to every validating TestChunk and `Statement.violated` set to whether ANY
 * validating test in this report failed. `Statement.violation_reason` is written
 * only on failure (naming the failing test(s)); on recovery it is CLEARED by a
 * separate `deleteNquads` mutation that removes the predicate entirely
 * (`<uid> <Statement.violation_reason> * .`). We do NOT clear it by writing
 * `violation_reason: ""` because Dgraph corrupts an empty-string scalar (`""`)
 * into `"[]"`; deleting the predicate is the only clean way.
 */
async function writeStatementGroup(dgraph: DgraphClientPort, group: StatementGroup): Promise<boolean> {
  const failed = group.failingTestNames.length > 0;
  const statementUid = await upsertByXid(dgraph, "Statement", group.xid, {
    "Statement.validated_by": group.validatingChunkUids.map((uid) => ({ uid })),
    "Statement.violated": failed,
    ...(failed ? { "Statement.violation_reason": `validating test failed: ${group.failingTestNames.join(", ")}` } : {}),
  });
  if (!failed) {
    await deletePredicate(dgraph, statementUid, "Statement.violation_reason");
  }
  return failed;
}

/**
 * Projects the descriptor's suite chain (outermost→innermost) as a parent-linked
 * spine of TestSuite nodes, each keyed by `${repo}|${file}|${chain.join(">")}`,
 * and returns the innermost suite's uid for the TestChunk to point at. A
 * descriptor with no suite writes nothing and returns undefined.
 */
async function projectSuiteChain(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
): Promise<string | undefined> {
  if (!descriptor.suite?.length) return undefined;
  let parentUid: string | undefined;
  for (let i = 0; i < descriptor.suite.length; i += 1) {
    const suiteChain = descriptor.suite.slice(0, i + 1).join(">");
    parentUid = await upsertByXid(dgraph, "TestSuite", `${repo}|${descriptor.file}|${suiteChain}`, {
      "TestSuite.repo": repo,
      "TestSuite.name": descriptor.suite[i],
      "TestSuite.file_path": descriptor.file,
      ...(parentUid ? { "TestSuite.parent": { uid: parentUid } } : {}),
    });
  }
  return parentUid;
}

export async function ingestTestReport(
  dgraph: DgraphClientPort,
  repo: string,
  report: TestReport,
): Promise<IngestTestReportResult> {
  let violated = 0;
  const resultById = new Map(report.results.map((result) => [result.id, result]));
  const entries: DescriptorChunk[] = [];
  for (const descriptor of report.tests) {
    const innermostSuiteUid = await projectSuiteChain(dgraph, repo, descriptor);
    const testChunkUid = await upsertByXid(dgraph, "TestChunk", `${repo}|${descriptor.id}`, {
      "TestChunk.repo": repo,
      "TestChunk.test_name": descriptor.name,
      "TestChunk.file_path": descriptor.file,
      ...(descriptor.startLine !== undefined ? { "TestChunk.start_line": descriptor.startLine } : {}),
      ...(descriptor.endLine !== undefined ? { "TestChunk.end_line": descriptor.endLine } : {}),
      ...(innermostSuiteUid ? { "TestChunk.suite": { uid: innermostSuiteUid } } : {}),
    });
    entries.push({ descriptor, testChunkUid });
  }

  const statementGroups = groupStatementsByAnchor(repo, entries, resultById);
  for (const group of statementGroups) {
    if (await writeStatementGroup(dgraph, group)) violated += 1;
  }
  const validatedBy = statementGroups.length;

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
