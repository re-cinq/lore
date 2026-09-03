/**
 * spec-traceability-graph — whole-test-file pruning, the deletion half of the
 * incremental CI ingest (specs/ci-incremental-ingest FR4). An incremental
 * test-report carries only CHANGED tests, so a test's absence stops meaning
 * deletion the way a full report's absence never did either — stale TestChunks
 * simply accumulated. The deleted paths ride beside the report instead, and
 * this deletes their subtrees: every TestChunk of the file (per-test and the
 * file-scoped coverage anchor), the file's TestSuites, the Coverage nodes
 * hanging off those chunks, and the incoming edges that would otherwise
 * dangle — a Statement's/AcceptanceCriterion's `validated_by` and the Repo
 * root's `test_chunks`/`test_suites` (the `<uid> * * .` delete drops only
 * OUTGOING edges; the dangling-Repo-ref lesson is deleteSpecSubtree's).
 * CodeChunks and Files the doomed Coverage covered are garbage-collected
 * through the shared ownership rules, with the doomed Coverage passed as
 * excluded owners so the GC can run before the delete (crash-safe order:
 * everything derived goes first, the chunks last, and a re-run converges
 * because the query keys on file_path, not remembered uids).
 */

import type { DgraphClientPort, UidRef } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";

interface DoomedFile {
  chunkUids: string[];
  suiteUids: string[];
  coverageUids: string[];
  coveredUids: string[];
  /** `Statement.validated_by` edges into the doomed chunks, as [owner, chunk]. */
  statementEdges: Array<[string, string]>;
  /** `AcceptanceCriterion.validated_by` edges into the doomed chunks. */
  criterionEdges: Array<[string, string]>;
  rootUid: string | null;
}

interface DoomedChunkRow {
  uid: string;
  stmts?: UidRef[];
  acs?: UidRef[];
  covIn?: Array<{ uid: string; covered?: UidRef[] }>;
  covOut?: { uid: string; covered?: UidRef[] };
}

async function queryFileSubtree(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<DoomedFile | null> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string, $file: string) {
        chunks(func: eq(TestChunk.repo, $repo))
            @filter(eq(TestChunk.file_path, $file)) {
          uid
          stmts: ~Statement.validated_by { uid }
          acs: ~AcceptanceCriterion.validated_by { uid }
          covIn: ~Coverage.test { uid covered: Coverage.covers { uid } }
          covOut: TestChunk.coverage { uid covered: Coverage.covers { uid } }
        }
        suites(func: eq(TestSuite.repo, $repo))
            @filter(eq(TestSuite.file_path, $file)) { uid }
        root(func: eq(Repo.xid, $repo)) { uid }
      }`,
      { $repo: repo, $file: filePath },
    );
    const chunks = (res.data?.chunks ?? []) as unknown as DoomedChunkRow[];
    const suites = (res.data?.suites ?? []) as unknown as UidRef[];

    if (chunks.length === 0 && suites.length === 0) {
      return null;
    }
    const coverageUids = new Set<string>();
    const coveredUids = new Set<string>();
    const statementEdges: Array<[string, string]> = [];
    const criterionEdges: Array<[string, string]> = [];

    for (const chunk of chunks) {
      const coverages = [...(chunk.covIn ?? [])];

      if (chunk.covOut) {
        coverages.push(chunk.covOut);
      }

      for (const coverage of coverages) {
        coverageUids.add(coverage.uid);

        for (const covered of coverage.covered ?? []) {
          coveredUids.add(covered.uid);
        }
      }

      for (const owner of chunk.stmts ?? []) {
        statementEdges.push([owner.uid, chunk.uid]);
      }

      for (const owner of chunk.acs ?? []) {
        criterionEdges.push([owner.uid, chunk.uid]);
      }
    }

    return {
      chunkUids: chunks.map((c) => c.uid),
      suiteUids: suites.map((s) => s.uid),
      coverageUids: [...coverageUids],
      coveredUids: [...coveredUids],
      statementEdges,
      criterionEdges,
      rootUid:
        (res.data?.root?.[0] as unknown as UidRef | undefined)?.uid ?? null,
    };
  });
}

/**
 * Deletes the graph subtree of each named test file. A file with no graph
 * presence is a no-op, so a re-driven or overlapping prune converges.
 */
export async function pruneTestFiles(
  dgraph: DgraphClientPort,
  repo: string,
  files: string[],
): Promise<{ prunedChunks: number }> {
  let prunedChunks = 0;

  for (const filePath of files) {
    const doomed = await queryFileSubtree(dgraph, repo, filePath);

    if (!doomed) {
      continue;
    }

    // GC before the delete, with the doomed nodes excluded as owners: a
    // CodeChunk/File still covered by another file's Coverage, or still
    // implementing a statement, survives.
    const excluded = new Set([...doomed.coverageUids, ...doomed.chunkUids]);

    await gcOrphanChunks(dgraph, "CodeChunk", doomed.coveredUids, [], excluded);
    await gcOrphanChunks(dgraph, "File", doomed.coveredUids, [], excluded);

    // One atomic mutation on freshly re-queried uids (Dgraph only detects
    // write-write conflicts, so the double read is the staleness guard).
    const target = await queryFileSubtree(dgraph, repo, filePath);

    if (!target) {
      continue;
    }
    const deletes = [
      ...target.chunkUids.map((uid) => `<${uid}> * * .`),
      ...target.suiteUids.map((uid) => `<${uid}> * * .`),
      ...target.coverageUids.map((uid) => `<${uid}> * * .`),
      ...target.statementEdges.map(
        ([owner, chunk]) => `<${owner}> <Statement.validated_by> <${chunk}> .`,
      ),
      ...target.criterionEdges.map(
        ([owner, chunk]) =>
          `<${owner}> <AcceptanceCriterion.validated_by> <${chunk}> .`,
      ),
    ];

    if (target.rootUid) {
      deletes.push(
        ...target.chunkUids.map(
          (uid) => `<${target.rootUid}> <Repo.test_chunks> <${uid}> .`,
        ),
        ...target.suiteUids.map(
          (uid) => `<${target.rootUid}> <Repo.test_suites> <${uid}> .`,
        ),
      );
    }
    await withTxn(dgraph, (txn) =>
      txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true }),
    );
    prunedChunks += target.chunkUids.length;
  }

  return { prunedChunks };
}
