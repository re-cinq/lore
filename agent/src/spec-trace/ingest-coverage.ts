/**
 * spec-traceability-graph — Phase 3 coverage ingest.
 *
 * Writes one Coverage node per record, keyed by `${repo}|${testFile}|${testName}`,
 * carrying repo/tool/commit, plus a `Coverage.covers` edge to every CodeChunk
 * whose line range overlaps a covered range. When a record names a TestChunk that
 * already exists (same repo/file_path/test_name), a `TestChunk.coverage` edge
 * (HAS_COVERAGE) is set to its Coverage node. Each covered range that overlaps no
 * CodeChunk contributes its line count to the returned `unmatched` total.
 *
 * Re-ingest is idempotent on the COVERS set: each record's `Coverage.covers`
 * edges are replaced (delete-then-set), not accumulated, so the persisted set
 * always mirrors the latest report. Coverage-first verification is a LATER facet.
 *
 * Shares the generic create-or-update primitive ({@link upsertByXid}) with the
 * Phase 1 projection via `./dgraph-upsert`. Talks only to the injected
 * DgraphClientPort; never imports the driver.
 */

import type { CoveredChunk, DgraphClientPort } from "@re-cinq/lore-shared";
import { upsertByXid, withTxn } from "./dgraph-upsert.js";

/** A CodeChunk's uid and line span as read back from Dgraph. */
type ChunkSpan = { uid: string; "CodeChunk.start_line": number; "CodeChunk.end_line": number };

/**
 * Result of resolving covered ranges against persisted CodeChunks: the deduped
 * uids of every overlapping chunk, plus the line count of ranges that matched no
 * chunk (`endLine - startLine + 1` summed over the unmatched ranges).
 */
type CoveredRangeMatch = { uids: string[]; unmatchedLines: number };

/** True when the covered range and the chunk's line span share at least one line. */
function rangesOverlap(range: CoveredChunk, chunk: ChunkSpan): boolean {
  return range.startLine <= chunk["CodeChunk.end_line"] && chunk["CodeChunk.start_line"] <= range.endLine;
}

/**
 * Resolves each covered range to the CodeChunks it overlaps. A range that
 * overlaps at least one chunk contributes those chunk uids; a range that
 * overlaps none contributes its line count to `unmatchedLines`.
 */
async function matchCoveredRanges(
  dgraph: DgraphClientPort,
  repo: string,
  covered: CoveredChunk[],
): Promise<CoveredRangeMatch> {
  const matched = new Set<string>();
  let unmatchedLines = 0;
  for (const range of covered) {
    const chunks = await withTxn(dgraph, async (txn) => {
      const res = await txn.queryWithVars(
        `query q($file: string, $repo: string){ chunks(func: eq(CodeChunk.file_path, $file)) @filter(eq(CodeChunk.repo, $repo)){ uid CodeChunk.start_line CodeChunk.end_line } }`,
        { $file: range.file, $repo: repo },
      );
      return (res.data?.chunks ?? []) as ChunkSpan[];
    });
    const rangeMatches = chunks.filter((chunk) => rangesOverlap(range, chunk));
    if (rangeMatches.length) {
      for (const chunk of rangeMatches) matched.add(chunk.uid);
    } else {
      unmatchedLines += range.endLine - range.startLine + 1;
    }
  }
  return { uids: [...matched], unmatchedLines };
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
  if (!testChunkUid) return;
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid: testChunkUid, "TestChunk.coverage": { uid: coverageUid } },
      commitNow: true,
    }),
  );
}

/**
 * Replaces a Coverage node's COVERS edges with exactly `coveredUids`. The stale
 * `Coverage.covers` set is unconditionally deleted, then re-set only when there
 * is something to point at — making re-ingest idempotent (the set mirrors the
 * latest report rather than accumulating). Delete and set run in separate
 * one-shot `withTxn` calls, matching {@link linkTestChunkCoverage}.
 */
async function replaceCovers(
  dgraph: DgraphClientPort,
  coverageUid: string,
  coveredUids: string[],
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({ deleteNquads: `<${coverageUid}> <Coverage.covers> * .`, commitNow: true }),
  );
  if (!coveredUids.length) return;
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid: coverageUid, "Coverage.covers": coveredUids.map((uid) => ({ uid })) },
      commitNow: true,
    }),
  );
}

export async function ingestCoverageReport(
  dgraph: DgraphClientPort,
  meta: { repo: string; tool: string; commit: string },
  records: Array<{ testFile: string; testName: string; covered: CoveredChunk[] }>,
): Promise<{ coverageNodes: number; coversEdges: number; unmatched: number }> {
  let coversEdges = 0;
  let unmatched = 0;
  for (const record of records) {
    const xid = `${meta.repo}|${record.testFile}|${record.testName}`;
    const { uids: coveredUids, unmatchedLines } = await matchCoveredRanges(dgraph, meta.repo, record.covered);
    const coverageUid = await upsertByXid(dgraph, "Coverage", xid, {
      "Coverage.repo": meta.repo,
      "Coverage.tool": meta.tool,
      "Coverage.commit": meta.commit,
    });
    await replaceCovers(dgraph, coverageUid, coveredUids);
    coversEdges += coveredUids.length;
    unmatched += unmatchedLines;

    await linkTestChunkCoverage(dgraph, meta.repo, record, coverageUid);
  }
  return { coverageNodes: records.length, coversEdges, unmatched };
}
