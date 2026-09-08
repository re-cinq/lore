/** Deletes a pruned test file's graph subtree (chunks/suites/coverage + dangling validated_by/Repo edges) for incremental ingest deletion (specs/ci-incremental-ingest FR4); GC runs before delete, keyed on file_path so a re-run converges. */

import type {
  DgraphClientPort,
  UidRef,
} from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
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

/** The `[owner, chunk]` pairs to delete, one per node claiming this chunk. */
function edgesFromOwners(
  owners: UidRef[] | undefined,
  chunkUid: string,
): Array<[string, string]> {
  return (owners ?? []).map((owner): [string, string] => [owner.uid, chunkUid]);
}

/** `TestChunk.coverage` is the only live chunk→Coverage edge; `Coverage.test` is unwritten dead schema. */
function collectCoverageUids(chunks: DoomedChunkRow[]): {
  coverageUids: string[];
  coveredUids: string[];
} {
  const coverageUids = new Set<string>();
  const coveredUids = new Set<string>();

  for (const chunk of chunks) {
    const covOut = chunk.covOut;

    if (covOut) {
      coverageUids.add(covOut.uid);
      (covOut.covered ?? []).forEach((coveredRef) =>
        coveredUids.add(coveredRef.uid),
      );
    }
  }

  return { coverageUids: [...coverageUids], coveredUids: [...coveredUids] };
}

function collectChunkEdges(chunks: DoomedChunkRow[]): {
  coverageUids: string[];
  coveredUids: string[];
  statementEdges: Array<[string, string]>;
  criterionEdges: Array<[string, string]>;
} {
  return {
    ...collectCoverageUids(chunks),
    statementEdges: chunks.flatMap((chunk) =>
      edgesFromOwners(chunk.stmts, chunk.uid),
    ),
    criterionEdges: chunks.flatMap((chunk) =>
      edgesFromOwners(chunk.acs, chunk.uid),
    ),
  };
}

/** The Repo anchor uid, or null when the repo has no graph node to detach the subtree from. */
function rootUidOf(root: UidRef[] | undefined): string | null {
  return root?.[0]?.uid ?? null;
}

/** The doomed subtree of one test file, or null when the file has no graph presence. */
function parseFileSubtreeResponse(res: {
  data: Record<string, Record<string, unknown>[] | undefined>;
}): DoomedFile | null {
  const chunks = (res.data.chunks ?? []) as unknown as DoomedChunkRow[];
  const suites = (res.data.suites ?? []) as unknown as UidRef[];

  if (chunks.length === 0 && suites.length === 0) {
    return null;
  }

  return {
    chunkUids: chunks.map((chunk) => chunk.uid),
    suiteUids: suites.map((suite) => suite.uid),
    ...collectChunkEdges(chunks),
    rootUid: rootUidOf(res.data.root as unknown as UidRef[] | undefined),
  };
}

/** Everything rooted at one test file. The reverse edges (`~Statement.validated_by`) are what make the delete complete — a chunk knows its coverage, but only the reverse direction finds the statements claiming it. */
const FILE_SUBTREE_QUERY = `query q($repo: string, $file: string) {
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
      }`;

async function queryFileSubtree(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<DoomedFile | null> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(FILE_SUBTREE_QUERY, {
      $repo: repo,
      $file: filePath,
    });

    return parseFileSubtreeResponse(res);
  });
}

/** Deletes the graph subtree of each named test file; a file with no graph presence is a no-op, so a re-driven or overlapping prune converges. */
type FileSubtree = NonNullable<Awaited<ReturnType<typeof queryFileSubtree>>>;

/** The Repo back-edges go too, or the repo keeps a list of uids that resolve to nothing. */
function repoEdgeDeletes(target: FileSubtree, rootUid: string): string[] {
  return [
    ...target.chunkUids.map(
      (uid) => `<${rootUid}> <Repo.test_chunks> <${uid}> .`,
    ),
    ...target.suiteUids.map(
      (uid) => `<${rootUid}> <Repo.test_suites> <${uid}> .`,
    ),
    ...target.coverageUids.map(
      (uid) => `<${rootUid}> <Repo.coverage> <${uid}> .`,
    ),
  ];
}

/** Everything a pruned test file takes with it: its chunks, suites and coverage rows, AND every edge pointing at them — a Statement left claiming `validated_by` a deleted chunk would still read as coverage. */
function deleteNquadsFor(target: FileSubtree): string[] {
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
    deletes.push(...repoEdgeDeletes(target, target.rootUid));
  }

  return deletes;
}

/** One test file's subtree, garbage-collected and then deleted; a file with no graph presence prunes nothing. */
async function pruneOneTestFile(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<number> {
  const doomed = await queryFileSubtree(dgraph, repo, filePath);

  if (!doomed) {
    return 0;
  }

  await gcCoveredNodes(dgraph, doomed);

  // Re-query uids before the atomic delete mutation — Dgraph only detects write-write conflicts, so this is the staleness guard.
  const target = await queryFileSubtree(dgraph, repo, filePath);

  if (!target) {
    return 0;
  }

  await deleteSubtree(dgraph, target);

  return target.chunkUids.length;
}

/** The atomic delete mutation for one already-GC'd file subtree. */
async function deleteSubtree(
  dgraph: DgraphClientPort,
  target: FileSubtree,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      deleteNquads: deleteNquadsFor(target).join("\n"),
      commitNow: true,
    }),
  );
}

/** Drops the CodeChunks and Files this test file was the last cover of. The doomed chunks and coverage rows are excluded as owners — they are about to go, so counting them would keep a genuinely orphaned node alive. */
async function gcCoveredNodes(
  dgraph: DgraphClientPort,
  doomed: FileSubtree,
): Promise<void> {
  const excludeOwners = new Set([...doomed.coverageUids, ...doomed.chunkUids]);

  for (const type of ["CodeChunk", "File"] as const) {
    await gcOrphanChunks(dgraph, type, {
      previous: doomed.coveredUids,
      current: [],
      excludeOwners,
    });
  }
}

export async function pruneTestFiles(
  dgraph: DgraphClientPort,
  repo: string,
  files: string[],
): Promise<{ prunedChunks: number }> {
  let prunedChunks = 0;

  for (const filePath of files) {
    prunedChunks += await pruneOneTestFile(dgraph, repo, filePath);
  }

  return { prunedChunks };
}
