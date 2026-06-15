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
import { deletePredicate, upsertByXid, withTxn } from "./dgraph-upsert.js";
import { ingestCoverageReport } from "./ingest-coverage.js";
import { parseSentenceLink, sentenceLinkFromSuite } from "./sentence-link.js";
import { resolveSentenceLink, type SentenceMatch } from "./resolve-sentence-link.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";

/** A coverage record as {@link ingestCoverageReport} consumes it. */
interface CoverageRecord {
  testFile: string;
  testName: string;
  covered: CoveredChunk[];
}

/**
 * Joins run results to their descriptors and projects covered ranges into
 * {@link ingestCoverageReport}'s record shape — ONE record per FILE (coverage is
 * file-level). Many per-`it` descriptors share a file's identical coverage; we
 * merge their ranges and key the record by the file (`testName = file`) so its
 * Coverage node attaches HAS_COVERAGE to the file-scoped TestChunk. Results with
 * no matching descriptor are dropped.
 */
function coverageRecordsFor(report: TestReport): CoverageRecord[] {
  const descriptorById = new Map(report.tests.map((descriptor) => [descriptor.id, descriptor]));
  const byFile = new Map<string, Map<string, CoveredChunk>>();
  for (const result of report.results) {
    const descriptor = descriptorById.get(result.id);
    if (!descriptor) continue;
    const ranges = byFile.get(descriptor.file) ?? byFile.set(descriptor.file, new Map()).get(descriptor.file)!;
    for (const chunk of result.covered) ranges.set(`${chunk.file}:${chunk.startLine}:${chunk.endLine}`, chunk);
  }
  return [...byFile].map(([file, ranges]) => ({ testFile: file, testName: file, covered: [...ranges.values()] }));
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

/**
 * A descriptor paired with the uids of (1) its own per-`it` TestChunk and (2) the
 * file-scoped TestChunk (`${repo}|${file}`) that owns coverage. `validated_by`
 * targets the file-scoped uid so it re-converges with `TestChunk.coverage`; the
 * per-`it` uid carries the descriptor's name/suite/line metadata.
 */
interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
  fileChunkUid: string;
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
  for (const { descriptor, fileChunkUid } of entries) {
    const anchor = parseSpecAnchor(descriptor.spec);
    if (!anchor) continue;
    const xid = `${repo}|${anchor.specPath}|${anchor.ordinal}`;
    const group = groups.get(xid) ?? { xid, validatingChunkUids: [], failingTestNames: [] };
    group.validatingChunkUids.push(fileChunkUid);
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

/** A sentence-resolved match node with the validating chunks + failing tests aggregated onto it. */
interface SentenceGroup extends SentenceMatch {
  validatingChunkUids: string[];
  failingTestNames: string[];
}

/**
 * Resolves every anchorless descriptor whose name parses as a
 * `<spec> | <sentence> | <label>` triple to the Statement/AcceptanceCriterion
 * nodes it sentence-matches, and aggregates the validating TestChunks (+ failing
 * test names) per resolved node. Mirrors {@link groupStatementsByAnchor} but
 * keys by the already-existing node uid (the resolver hit live nodes). Descriptors
 * that carry a spec anchor are left to the anchor path.
 */
async function groupStatementsBySentence(
  dgraph: DgraphClientPort,
  repo: string,
  entries: DescriptorChunk[],
  resultById: Map<string, TaggedRunResult>,
): Promise<SentenceGroup[]> {
  const groups = new Map<string, SentenceGroup>();
  for (const { descriptor, fileChunkUid } of entries) {
    if (parseSpecAnchor(descriptor.spec)) continue;
    // Structural (describe-nesting) link is primary; fall back to a hand-written
    // `<spec> | <sentence> | <label>` name for backward compatibility.
    const link = sentenceLinkFromSuite(descriptor) ?? parseSentenceLink(descriptor.name);
    if (!link) continue;
    for (const match of await resolveSentenceLink(dgraph, repo, link)) {
      const group = groups.get(match.uid) ?? { ...match, validatingChunkUids: [], failingTestNames: [] };
      group.validatingChunkUids.push(fileChunkUid);
      if (resultById.get(descriptor.id)?.passed === false) group.failingTestNames.push(descriptor.name);
      groups.set(match.uid, group);
    }
  }
  return [...groups.values()];
}

/**
 * Writes a sentence-resolved group onto its existing node by uid: a
 * `<nodeType>.validated_by` edge to every validating TestChunk, `<nodeType>.violated`
 * for any failing validator, and `<nodeType>.violation_reason` (cleared via
 * {@link deletePredicate} on recovery — never written as `""`, see the anchor writer).
 */
async function writeSentenceGroup(dgraph: DgraphClientPort, group: SentenceGroup): Promise<boolean> {
  const failed = group.failingTestNames.length > 0;
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid: group.uid,
        [`${group.nodeType}.validated_by`]: group.validatingChunkUids.map((uid) => ({ uid })),
        [`${group.nodeType}.violated`]: failed,
        ...(failed
          ? { [`${group.nodeType}.violation_reason`]: `validating test failed: ${group.failingTestNames.join(", ")}` }
          : {}),
      },
      commitNow: true,
    }),
  );
  if (!failed) await deletePredicate(dgraph, group.uid, `${group.nodeType}.violation_reason`);
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
  const fileChunkUidByFile = new Map<string, string>();
  const repoTestChunkUids = new Set<string>();
  const repoSuiteUids = new Set<string>();
  for (const descriptor of report.tests) {
    const innermostSuiteUid = await projectSuiteChain(dgraph, repo, descriptor);
    if (innermostSuiteUid) repoSuiteUids.add(innermostSuiteUid);
    const testChunkUid = await upsertByXid(dgraph, "TestChunk", `${repo}|${descriptor.id}`, {
      "TestChunk.repo": repo,
      "TestChunk.test_name": descriptor.name,
      "TestChunk.file_path": descriptor.file,
      ...(descriptor.startLine !== undefined ? { "TestChunk.start_line": descriptor.startLine } : {}),
      ...(descriptor.endLine !== undefined ? { "TestChunk.end_line": descriptor.endLine } : {}),
      ...(innermostSuiteUid ? { "TestChunk.suite": { uid: innermostSuiteUid } } : {}),
    });
    // The file-scoped TestChunk that owns coverage — `validated_by` targets this
    // so the chain reconverges. Same xid coverage + the spec projector key on.
    let fileChunkUid = fileChunkUidByFile.get(descriptor.file);
    if (fileChunkUid === undefined) {
      fileChunkUid = await upsertByXid(dgraph, "TestChunk", fileScopedTestChunkXid(repo, descriptor.file), {
        "TestChunk.repo": repo,
        "TestChunk.file_path": descriptor.file,
        // test_name = file so the file-level coverage record (keyed by file, file)
        // attaches HAS_COVERAGE to THIS node — the same one validated_by targets.
        "TestChunk.test_name": descriptor.file,
      });
      fileChunkUidByFile.set(descriptor.file, fileChunkUid);
    }
    repoTestChunkUids.add(testChunkUid).add(fileChunkUid);
    entries.push({ descriptor, testChunkUid, fileChunkUid });
  }

  // Attach every TestChunk + (leaf) TestSuite to the Repo root so the test layer
  // is reachable from the graph's entry point (parent suites hang off the leaf via
  // ~TestSuite.parent). Set-union dedups across re-ingests.
  await upsertByXid(dgraph, "Repo", repo, {
    ...(repoTestChunkUids.size ? { "Repo.test_chunks": [...repoTestChunkUids].map((uid) => ({ uid })) } : {}),
    ...(repoSuiteUids.size ? { "Repo.test_suites": [...repoSuiteUids].map((uid) => ({ uid })) } : {}),
  });

  const statementGroups = groupStatementsByAnchor(repo, entries, resultById);
  for (const group of statementGroups) {
    if (await writeStatementGroup(dgraph, group)) violated += 1;
  }
  const sentenceGroups = await groupStatementsBySentence(dgraph, repo, entries, resultById);
  for (const group of sentenceGroups) {
    if (await writeSentenceGroup(dgraph, group)) violated += 1;
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
