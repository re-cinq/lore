/** Deletes a pruned test file's graph subtree (chunks/suites/coverage + dangling validated_by/Repo edges) for incremental ingest deletion (specs/ci-incremental-ingest FR4); GC runs before delete, keyed on file_path so a re-run converges. */

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
      // `TestChunk.coverage` is the only live chunk→Coverage edge; `Coverage.test` is unwritten dead schema.
      if (chunk.covOut) {
        coverageUids.add(chunk.covOut.uid);
        (chunk.covOut.covered ?? []).forEach((coveredRef) =>
          coveredUids.add(coveredRef.uid),
        );
      }
      statementEdges.push(
        ...(chunk.stmts ?? []).map((owner): [string, string] => [
          owner.uid,
          chunk.uid,
        ]),
      );
      criterionEdges.push(
        ...(chunk.acs ?? []).map((owner): [string, string] => [
          owner.uid,
          chunk.uid,
        ]),
      );
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

/** Deletes the graph subtree of each named test file; a file with no graph presence is a no-op, so a re-driven or overlapping prune converges. */
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

    // GC before delete, excluding doomed nodes as owners, so a still-referenced CodeChunk/File survives.
    const excluded = new Set([...doomed.coverageUids, ...doomed.chunkUids]);

    await gcOrphanChunks(dgraph, "CodeChunk", {
      previous: doomed.coveredUids,
      current: [],
      excludeOwners: excluded,
    });
    await gcOrphanChunks(dgraph, "File", {
      previous: doomed.coveredUids,
      current: [],
      excludeOwners: excluded,
    });

    // Re-query uids before the atomic delete mutation — Dgraph only detects write-write conflicts, so this is the staleness guard.
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
        ...target.coverageUids.map(
          (uid) => `<${target.rootUid}> <Repo.coverage> <${uid}> .`,
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
