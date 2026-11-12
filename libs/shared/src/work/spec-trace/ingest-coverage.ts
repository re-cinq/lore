/** Phase 3 coverage ingest; writes Coverage nodes keyed by scope|testFile|testName; aggregates to File nodes with ranges facets. */

import type {
  CoveredChunk,
  DgraphClientPort,
} from "../../outbound/spec-trace/deps.js";
import {
  upsertByXid,
  withTxn,
  replaceEdge,
  replaceEdgeWithFacets,
  type FacetedTarget,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  isOverlay,
  rootEdge,
  scopedXid,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import { groupRangesByFile, serializeRanges } from "./coverage-ranges.js";
import { stampGraphBaseline } from "./graph-baseline.js";
import {
  holdersOf,
  isCoverageUnchanged,
  NO_STORED_TESTS,
  type PlannedCoverage,
  type StoredCoverage,
  type StoredTestLayer,
} from "./stored-test-layer.js";
import { firstOf } from "./uid-refs.js";

/** What one coverage ingest is expressed against: the scope it writes into, the tool that produced it, and the commit its line numbers belong to. */
export interface CoverageMeta {
  scope: TraceScope;
  tool: string;
  commit: string;
}

/** One coverage record: the test it belongs to and the ranges it covered. */
interface CoverageRecord {
  testFile: string;
  testName: string;
  covered: CoveredChunk[];
}

/** One report's coverage ingest: what it writes against, what the graph already holds, the records it has handled so far, and what it settles for the kept ones once every record is in. */
interface CoverageRun {
  dgraph: DgraphClientPort;
  meta: CoverageMeta;
  stored: StoredTestLayer;
  knownFiles: FileUids;
  seen: Set<string>;
  rootCoverage: Set<string>;
  rootFiles: Set<string>;
  staleCommits: string[];
}

/** Writes each record's Coverage node, its covered files, its root edges and its test's link, exactly as before, unless `stored` holds the record as written; the kept records then take this report's commit and their root edges in one write each. */
export async function ingestCoverageReport(
  dgraph: DgraphClientPort,
  meta: CoverageMeta,
  records: CoverageRecord[],
  stored: StoredTestLayer = NO_STORED_TESTS,
): Promise<{ coverageNodes: number; coversEdges: number; unmatched: number }> {
  const run = newCoverageRun(dgraph, meta, stored);
  let coversEdges = 0;

  for (const record of records) {
    coversEdges += await ingestOneCoverage(run, record);
  }
  await settleCoverageRun(run);

  // Ranges expressed in this commit's line numbering; stamp once per report for pre-merge query alignment. An overlay stamps its OWN anchor instead — a branch push must never move main's coordinate system.
  if (records.length && !isOverlay(meta.scope)) {
    await stampGraphBaseline(dgraph, meta.scope.repo, meta.commit, new Date());
  }

  // `coversEdges` counts covered FILES; `unmatched` always 0 (for return-shape stability).
  return { coverageNodes: records.length, coversEdges, unmatched: 0 };
}

function newCoverageRun(
  dgraph: DgraphClientPort,
  meta: CoverageMeta,
  stored: StoredTestLayer,
): CoverageRun {
  return {
    dgraph,
    meta,
    stored,
    knownFiles: new Map(),
    seen: new Set(),
    rootCoverage: new Set(),
    rootFiles: new Set(),
    staleCommits: [],
  };
}

/** The File uid of every xid this report has already upserted. Every test of a file covers the same files, and a File node holds only its repo and path, so one upsert per File per report is enough: re-upserting it for each of a file's tests was most of a report's Dgraph round trips. */
type FileUids = Map<string, string>;

/** Ingests one record, or keeps it when the graph holds it as written; answers how many files it covers. */
async function ingestOneCoverage(
  run: CoverageRun,
  record: CoverageRecord,
): Promise<number> {
  const held = keepableCoverage(run, record);

  return held ? keepCoverage(run, held) : writeCoverage(run, record);
}

/** The stored coverage this record would write unchanged, if any; a record the report names twice is written after the first time, so the last one wins, as when every record was written. */
function keepableCoverage(
  { meta, stored, seen }: CoverageRun,
  record: CoverageRecord,
): StoredCoverage | undefined {
  const { testFile, testName } = record;
  const xid = scopedXid(meta.scope, testFile, testName);
  const held = seen.has(xid) ? undefined : stored.coverage.get(xid);
  const holders = holdersOf(stored, testFile, testName);

  seen.add(xid);

  return isCoverageUnchanged(held, plannedCoverage(meta, record), {
    sources: stored.sources,
    holders,
  })
    ? held
    : undefined;
}

/** What writing this record would store: its repo and tool, and per covered file the serialized ranges and the xid of the File node the edge points at. */
function plannedCoverage(
  meta: CoverageMeta,
  record: CoverageRecord,
): PlannedCoverage {
  const covers = new Map<string, { ranges: string; fileXid: string }>();

  for (const [file, ranges] of groupRangesByFile(record.covered)) {
    covers.set(file, {
      ranges: serializeRanges(ranges),
      fileXid: scopedXid(meta.scope, file),
    });
  }

  return { repo: meta.scope.key, tool: meta.tool, covers };
}

/** Folds a coverage the graph already holds into the run: its root edges, its files for later records, and its commit when this report's differs. */
function keepCoverage(run: CoverageRun, held: StoredCoverage): number {
  const { meta, knownFiles } = run;

  for (const [path, cover] of held.covers) {
    knownFiles.set(scopedXid(meta.scope, path), cover.uid);
    run.rootFiles.add(cover.uid);
  }

  if (held.commit !== meta.commit) {
    run.rootCoverage.add(held.uid);
    run.staleCommits.push(held.uid);
  }

  return held.covers.size;
}

/** Writes one record exactly as before: its Coverage node, its covered files, its root edges, then its test's link. */
async function writeCoverage(
  run: CoverageRun,
  record: CoverageRecord,
): Promise<number> {
  const { dgraph, meta, knownFiles } = run;
  const { scope } = meta;
  const coverageUid = await upsertCoverageNode(dgraph, meta, record);
  const fileUids = await replaceCovers(dgraph, coverageUid, record, {
    scope,
    knownFiles,
  });

  await attachCoverageToScopeRoot(dgraph, scope, {
    coverage: [coverageUid],
    files: fileUids,
  });
  await linkTestChunkCoverage(dgraph, scope, record, coverageUid);

  return fileUids.length;
}

/** Brings the commit of every kept coverage up to this report's in one write, then hangs the kept records' nodes off the root in another. */
async function settleCoverageRun(run: CoverageRun): Promise<void> {
  const { dgraph, meta } = run;

  await restampCommits(dgraph, run.staleCommits, meta.commit);
  await attachCoverageToScopeRoot(dgraph, meta.scope, {
    coverage: [...run.rootCoverage],
    files: [...run.rootFiles],
  });
}

/** Sets `Coverage.commit` on every kept node at once; N-Quads also store an empty commit, which JSON would drop. */
async function restampCommits(
  dgraph: DgraphClientPort,
  coverageUids: string[],
  commit: string,
): Promise<void> {
  if (!coverageUids.length) {
    return;
  }
  const value = JSON.stringify(commit);

  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setNquads: coverageUids
        .map((uid) => `<${uid}> <Coverage.commit> ${value} .`)
        .join("\n"),
      commitNow: true,
    }),
  );
}

/** Sets TestChunk.coverage edge when matching TestChunk exists; query and mutate in separate txns. */
async function linkTestChunkCoverage(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  record: { testFile: string; testName: string },
  coverageUid: string,
): Promise<void> {
  const testChunkUid = await findTestChunkUid(dgraph, scope, record);

  if (!testChunkUid) {
    return;
  }
  await replaceEdge(dgraph, testChunkUid, "TestChunk.coverage", [coverageUid]);
}

/** The uid of the TestChunk this coverage record describes, or undefined when no ingest has projected one. */
async function findTestChunkUid(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  record: { testFile: string; testName: string },
): Promise<string | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($file: string, $name: string, $repo: string){ tc(func: eq(TestChunk.file_path, $file)) @filter(eq(TestChunk.test_name, $name) AND eq(TestChunk.repo, $repo)){ uid } }`,
      { $file: record.testFile, $name: record.testName, $repo: scope.key },
    );

    return firstOf(res.data.tc)?.uid as string | undefined;
  });
}

/** Points this coverage at the files it now covers. The previous targets are read BEFORE the replace: after it, there is no record of what this coverage used to own. */
async function replaceCovers(
  dgraph: DgraphClientPort,
  coverageUid: string,
  record: { covered: CoveredChunk[] },
  { scope, knownFiles }: { scope: TraceScope; knownFiles: FileUids },
): Promise<string[]> {
  const previousCovers = await readCoversUids(dgraph, coverageUid);
  const fileTargets = await upsertCoveredFiles(
    dgraph,
    scope,
    record.covered,
    knownFiles,
  );

  await replaceCoverTargets(dgraph, coverageUid, previousCovers, fileTargets);

  return fileTargets.map((t) => t.uid);
}

/** Repoints the coverage at its new file targets and garbage-collects the ones it dropped: a File node nothing points at is unreachable from the graph's entry point while still occupying it. */
async function replaceCoverTargets(
  dgraph: DgraphClientPort,
  coverageUid: string,
  previous: string[],
  fileTargets: FacetedTarget[],
): Promise<void> {
  await replaceEdgeWithFacets(
    dgraph,
    coverageUid,
    "Coverage.covers",
    fileTargets,
  );
  await gcOrphanChunks(dgraph, "File", {
    previous,
    current: fileTargets.map((t) => t.uid),
  });
}

/** Reads a Coverage node's current `Coverage.covers` target uids. */
async function readCoversUids(
  dgraph: DgraphClientPort,
  coverageUid: string,
): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($uid: string) { cov(func: uid($uid)) { Coverage.covers { uid } } }`,
      { $uid: coverageUid },
    );
    const covers = (firstOf(res.data.cov)?.["Coverage.covers"] ?? []) as {
      uid: string;
    }[];

    return covers.map((c) => c.uid);
  });
}

/** Upserts File nodes and returns as faceted edge targets with merged intervals serialized to ranges facet. */
async function upsertCoveredFiles(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  covered: CoveredChunk[],
  knownFiles: FileUids,
): Promise<FacetedTarget[]> {
  const targets: FacetedTarget[] = [];

  for (const [file, ranges] of groupRangesByFile(covered)) {
    const xid = scopedXid(scope, file);
    const uid =
      knownFiles.get(xid) ??
      (await upsertByXid(dgraph, "File", xid, {
        "File.repo": scope.key,
        "File.path": file,
      }));

    knownFiles.set(xid, uid);
    targets.push({ uid, facets: { ranges: serializeRanges(ranges) } });
  }

  return targets;
}

/** Hangs coverage nodes and the files they cover off the scope's root — the Repo node on main, the branch's Overlay node otherwise — so both stay reachable from the graph's entry point; a run with no records writes nothing. */
async function attachCoverageToScopeRoot(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  { coverage, files }: { coverage: string[]; files: string[] },
): Promise<void> {
  if (!coverage.length) {
    return;
  }
  await upsertByXid(dgraph, scope.rootType, scope.key, {
    [rootEdge(scope, "coverage")]: coverage.map((uid) => ({ uid })),
    ...(files.length
      ? { [rootEdge(scope, "files")]: files.map((uid) => ({ uid })) }
      : {}),
  });
}

/** The Coverage node for one test file, keyed inside the scope so a branch's record never overwrites main's. */
async function upsertCoverageNode(
  dgraph: DgraphClientPort,
  meta: CoverageMeta,
  record: { testFile: string; testName: string },
): Promise<string> {
  return upsertByXid(
    dgraph,
    "Coverage",
    scopedXid(meta.scope, record.testFile, record.testName),
    {
      "Coverage.repo": meta.scope.key,
      "Coverage.tool": meta.tool,
      "Coverage.commit": meta.commit,
    },
  );
}
