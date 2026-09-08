/** Phase 3 coverage ingest; writes Coverage nodes keyed by repo|testFile|testName; aggregates to File nodes with ranges facets. */

import type {
  CoveredChunk,
  DgraphClientPort,
} from "../../outbound/spec-trace/deps.js";
import {
  upsertByXid,
  withTxn,
  replaceEdgeWithFacets,
  type FacetedTarget,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import { stampGraphBaseline } from "./graph-baseline.js";
import { firstOf } from "./uid-refs.js";

/** Serializes a file's covered intervals (in covered order) to the `ranges` edge facet, e.g. "5-10,20-25". */
function serializeRanges(ranges: CoveredChunk[]): string {
  return ranges.map((r) => `${r.startLine}-${r.endLine}`).join(",");
}

/** Groups covered intervals by the file they belong to, preserving covered order within each file. */
function groupRangesByFile(
  covered: CoveredChunk[],
): Map<string, CoveredChunk[]> {
  const rangesByFile = new Map<string, CoveredChunk[]>();

  for (const range of covered) {
    (
      rangesByFile.get(range.file) ??
      rangesByFile.set(range.file, []).get(range.file)!
    ).push(range);
  }

  return rangesByFile;
}

/** Upserts File nodes and returns as faceted edge targets with merged intervals serialized to ranges facet. */
async function upsertCoveredFiles(
  dgraph: DgraphClientPort,
  repo: string,
  covered: CoveredChunk[],
): Promise<FacetedTarget[]> {
  const targets: FacetedTarget[] = [];

  for (const [file, ranges] of groupRangesByFile(covered)) {
    const uid = await upsertByXid(dgraph, "File", `${repo}|${file}`, {
      "File.repo": repo,
      "File.path": file,
    });

    targets.push({ uid, facets: { ranges: serializeRanges(ranges) } });
  }

  return targets;
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

/** The uid of the TestChunk this coverage record describes, or undefined when no ingest has projected one. */
async function findTestChunkUid(
  dgraph: DgraphClientPort,
  repo: string,
  record: { testFile: string; testName: string },
): Promise<string | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($file: string, $name: string, $repo: string){ tc(func: eq(TestChunk.file_path, $file)) @filter(eq(TestChunk.test_name, $name) AND eq(TestChunk.repo, $repo)){ uid } }`,
      { $file: record.testFile, $name: record.testName, $repo: repo },
    );

    return firstOf(res.data.tc)?.uid as string | undefined;
  });
}

/** Sets TestChunk.coverage edge when matching TestChunk exists; query and mutate in separate txns. */
async function linkTestChunkCoverage(
  dgraph: DgraphClientPort,
  repo: string,
  record: { testFile: string; testName: string },
  coverageUid: string,
): Promise<void> {
  const testChunkUid = await findTestChunkUid(dgraph, repo, record);

  if (!testChunkUid) {
    return;
  }
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: {
        uid: testChunkUid,
        "TestChunk.coverage": { uid: coverageUid },
      },
      commitNow: true,
    }),
  );
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

/** Points this coverage at the files it now covers. The previous targets are read BEFORE the replace: after it, there is no record of what this coverage used to own. */
async function replaceCovers(
  dgraph: DgraphClientPort,
  repo: string,
  coverageUid: string,
  record: { covered: CoveredChunk[] },
): Promise<string[]> {
  const previousCovers = await readCoversUids(dgraph, coverageUid);
  const fileTargets = await upsertCoveredFiles(dgraph, repo, record.covered);

  await replaceCoverTargets(dgraph, coverageUid, previousCovers, fileTargets);

  return fileTargets.map((t) => t.uid);
}

/** Hangs the coverage node and the files it covers off the Repo root, so both stay reachable from the graph's entry point. */
async function attachCoverageToRepoRoot(
  dgraph: DgraphClientPort,
  repo: string,
  coverageUid: string,
  fileUids: string[],
): Promise<void> {
  await upsertByXid(dgraph, "Repo", repo, {
    "Repo.coverage": [{ uid: coverageUid }],
    ...(fileUids.length
      ? { "Repo.files": fileUids.map((uid) => ({ uid })) }
      : {}),
  });
}

async function ingestOneCoverage(
  dgraph: DgraphClientPort,
  meta: { repo: string; tool: string; commit: string },
  record: { testFile: string; testName: string; covered: CoveredChunk[] },
): Promise<number> {
  const xid = `${meta.repo}|${record.testFile}|${record.testName}`;
  const coverageUid = await upsertByXid(dgraph, "Coverage", xid, {
    "Coverage.repo": meta.repo,
    "Coverage.tool": meta.tool,
    "Coverage.commit": meta.commit,
  });
  const fileUids = await replaceCovers(dgraph, meta.repo, coverageUid, record);

  await attachCoverageToRepoRoot(dgraph, meta.repo, coverageUid, fileUids);
  await linkTestChunkCoverage(dgraph, meta.repo, record, coverageUid);

  return fileUids.length;
}

export async function ingestCoverageReport(
  dgraph: DgraphClientPort,
  meta: { repo: string; tool: string; commit: string },
  records: Array<{
    testFile: string;
    testName: string;
    covered: CoveredChunk[];
  }>,
): Promise<{ coverageNodes: number; coversEdges: number; unmatched: number }> {
  let coversEdges = 0;

  for (const record of records) {
    coversEdges += await ingestOneCoverage(dgraph, meta, record);
  }

  // Ranges expressed in this commit's line numbering; stamp once per report for pre-merge query alignment.
  if (records.length) {
    await stampGraphBaseline(dgraph, meta.repo, meta.commit, new Date());
  }

  // `coversEdges` counts covered FILES; `unmatched` always 0 (for return-shape stability).
  return { coverageNodes: records.length, coversEdges, unmatched: 0 };
}
