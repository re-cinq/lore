/**
 * spec-traceability-graph — Phase 3 coverage ingest.
 *
 * Writes one Coverage node per record, keyed by `${repo}|${testFile}|${testName}`,
 * carrying repo/tool/commit. The covered code is aggregated to **File** nodes
 * (one per `${repo}|${file}`): each covered file gets a `Coverage --covers--> File`
 * edge whose covered line intervals live on a `Coverage.covers|ranges` edge facet
 * ("5-10,20-25") — no per-range node explosion. When a record names a TestChunk
 * that already exists (same repo/file_path/test_name), a `TestChunk.coverage` edge
 * (HAS_COVERAGE) is set to its Coverage node.
 *
 * Re-ingest replaces the `Coverage.covers` set (delete-then-set, with facets), then
 * GCs the File nodes that dropped out of coverage and no other coverage owns (via
 * the shared {@link gcOrphanChunks}) — so a file that stops being covered doesn't
 * linger as an orphan node.
 *
 * Shares the generic create-or-update primitive ({@link upsertByXid}) with the
 * Phase 1 projection via `./dgraph-upsert`. Talks only to the injected
 * DgraphClientPort; never imports the driver.
 */

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

/**
 * Upserts one File node per covered file (xid `${repo}|${file}`) and returns each
 * as a faceted edge target — the file's merged intervals serialized onto the
 * `Coverage.covers|ranges` facet. Files preserve first-seen order; their intervals
 * preserve covered order.
 */
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

/**
 * Sets the HAS_COVERAGE edge (`TestChunk.coverage` → Coverage) when a TestChunk
 * matching the record (repo + file_path=testFile + test_name=testName) already
 * exists. Absent a match the edge is left untouched. Query and mutate run in
 * separate one-shot `withTxn` calls — the established pattern for this driver.
 */
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
    // Delete the File nodes this coverage dropped that no other coverage still owns.
    await gcOrphanChunks(dgraph, "File", previousCovers, fileUids);
    coversEdges += fileUids.length;

    // Connect the Coverage node and its covered Files to the Repo root so neither
    // is orphaned from the graph's entry point (set-union dedups on re-ingest).
    await upsertByXid(dgraph, "Repo", meta.repo, {
      "Repo.coverage": [{ uid: coverageUid }],
      ...(fileUids.length
        ? { "Repo.files": fileUids.map((uid) => ({ uid })) }
        : {}),
    });

    await linkTestChunkCoverage(dgraph, meta.repo, record, coverageUid);
  }

  // The ranges just written are expressed in this commit's line numbering, so
  // stamp it once per report — the pre-merge impact query aligns a PR diff to
  // these coordinates rather than guessing. Skipped when nothing was written:
  // advancing the baseline past ranges that did not move would claim more than
  // the data supports.
  if (records.length) {
    await stampGraphBaseline(dgraph, meta.repo, meta.commit, new Date());
  }

  // `coversEdges` counts covered FILES (one Coverage→File edge each); `unmatched`
  // is always 0 now (every covered file is upserted). Both kept for return-shape
  // stability with existing callers.
  return { coverageNodes: records.length, coversEdges, unmatched: 0 };
}
