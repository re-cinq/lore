/** Phase 3 coverage ingest; writes Coverage nodes keyed by repo|testFile|testName; aggregates to File nodes with ranges facets. */

import type { CoveredChunk, DgraphClientPort } from "./deps.js";
import {
  upsertByXid,
  withTxn,
  replaceEdgeWithFacets,
  type FacetedTarget,
} from "./dgraph-upsert.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import { stampGraphBaseline } from "./graph-baseline.js";

/** Serializes a file's covered intervals (in covered order) to the `ranges` edge facet, e.g. "5-10,20-25". */
function serializeRanges(ranges: CoveredChunk[]): string {
  return ranges.map((r) => `${r.startLine}-${r.endLine}`).join(",");
}

/** Upserts File nodes and returns as faceted edge targets with merged intervals serialized to ranges facet. */
async function upsertCoveredFiles(
  dgraph: DgraphClientPort,
  repo: string,
  covered: CoveredChunk[],
): Promise<FacetedTarget[]> {
  const rangesByFile = new Map<string, CoveredChunk[]>();

  for (const range of covered) {
    (
      rangesByFile.get(range.file) ??
      rangesByFile.set(range.file, []).get(range.file)!
    ).push(range);
  }
  const targets: FacetedTarget[] = [];

  for (const [file, ranges] of rangesByFile) {
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
    const covers = (res.data?.cov?.[0]?.["Coverage.covers"] ?? []) as {
      uid: string;
    }[];

    return covers.map((c) => c.uid);
  });
}

/** Sets TestChunk.coverage edge when matching TestChunk exists; query and mutate in separate txns. */
async function linkTestChunkCoverage(
  dgraph: DgraphClientPort,
  repo: string,
  record: { testFile: string; testName: string },
  coverageUid: string,
): Promise<void> {
  const testChunkUid = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($file: string, $name: string, $repo: string){ tc(func: eq(TestChunk.file_path, $file)) @filter(eq(TestChunk.test_name, $name) AND eq(TestChunk.repo, $repo)){ uid } }`,
      { $file: record.testFile, $name: record.testName, $repo: repo },
    );

    return res.data?.tc?.[0]?.uid as string | undefined;
  });

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
    const xid = `${meta.repo}|${record.testFile}|${record.testName}`;
    const coverageUid = await upsertByXid(dgraph, "Coverage", xid, {
      "Coverage.repo": meta.repo,
      "Coverage.tool": meta.tool,
      "Coverage.commit": meta.commit,
    });
    const previousCovers = await readCoversUids(dgraph, coverageUid);
    const fileTargets = await upsertCoveredFiles(
      dgraph,
      meta.repo,
      record.covered,
    );
    const fileUids = fileTargets.map((t) => t.uid);

    await replaceEdgeWithFacets(
      dgraph,
      coverageUid,
      "Coverage.covers",
      fileTargets,
    );
    // GC File nodes this coverage dropped if no other coverage owns them.
    await gcOrphanChunks(dgraph, "File", {
      previous: previousCovers,
      current: fileUids,
    });
    coversEdges += fileUids.length;

    // Connect Coverage and Files to Repo root to prevent orphaning from graph entry point.
    await upsertByXid(dgraph, "Repo", meta.repo, {
      "Repo.coverage": [{ uid: coverageUid }],
      ...(fileUids.length
        ? { "Repo.files": fileUids.map((uid) => ({ uid })) }
        : {}),
    });

    await linkTestChunkCoverage(dgraph, meta.repo, record, coverageUid);
  }

  // Ranges expressed in this commit's line numbering; stamp once per report for pre-merge query alignment.
  if (records.length) {
    await stampGraphBaseline(dgraph, meta.repo, meta.commit, new Date());
  }

  // `coversEdges` counts covered FILES; `unmatched` always 0 (for return-shape stability).
  return { coverageNodes: records.length, coversEdges, unmatched: 0 };
}
