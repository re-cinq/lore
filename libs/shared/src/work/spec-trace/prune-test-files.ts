/** Deletes a pruned test file's graph subtree (chunks/suites/coverage + dangling validated_by/Repo edges) for incremental ingest deletion (specs/ci-incremental-ingest FR4); GC runs before delete, keyed on file_path so a re-run converges. */

import type {
  DgraphClientPort,
  TestDescriptor,
  UidRef,
} from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  mainScope,
  rootEdge,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import {
  fileScopedTestChunkXid,
  suiteLevelXid,
  testChunkXid,
} from "./test-chunk-identity.js";

/** The rows of one test file a prune leaves in place, by xid. */
interface KeptRows {
  chunkXids: Set<string>;
  suiteXids: Set<string>;
}

const KEEP_NOTHING: KeptRows = { chunkXids: new Set(), suiteXids: new Set() };

export async function pruneTestFiles(
  dgraph: DgraphClientPort,
  repo: string,
  files: string[],
): Promise<{ prunedChunks: number }> {
  const scope = mainScope(repo);
  let prunedChunks = 0;

  for (const filePath of files) {
    prunedChunks += await pruneOneTestFile(
      dgraph,
      scope,
      filePath,
      KEEP_NOTHING,
    );
  }

  return { prunedChunks };
}

/** Removes what a report no longer lists under each file it carries, in the report's own scope: a report holds a file's tests whole, so a test missing from it was renamed or removed. The file's own chunk stays, because every citation of the file targets it, and a file the report does not carry is left alone. */
export async function pruneUnreportedTests(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptors: TestDescriptor[],
): Promise<void> {
  for (const [file, kept] of keptRowsByFile(scope, descriptors)) {
    await pruneOneTestFile(dgraph, scope, file, kept);
  }
}

/** The rows each carried file keeps: its own chunk, and every listed test's chunk and suite chain. */
function keptRowsByFile(
  scope: TraceScope,
  descriptors: TestDescriptor[],
): Map<string, KeptRows> {
  const byFile = new Map<string, KeptRows>();

  for (const descriptor of descriptors) {
    const kept = byFile.get(descriptor.file) ?? {
      chunkXids: new Set([fileScopedTestChunkXid(scope.key, descriptor.file)]),
      suiteXids: new Set<string>(),
    };

    kept.chunkXids.add(testChunkXid(scope, descriptor.id));
    (descriptor.suite ?? []).forEach((_, depth) =>
      kept.suiteXids.add(suiteLevelXid(scope, descriptor, depth)),
    );
    byFile.set(descriptor.file, kept);
  }

  return byFile;
}

/** Every test file the graph holds rows for in `repo`'s main scope, which a full ingest prunes against. */
export async function listTestFilePaths(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string) {
        chunks(func: eq(TestChunk.repo, $repo)) { path: TestChunk.file_path }
        suites(func: eq(TestSuite.repo, $repo)) { path: TestSuite.file_path }
      }`,
      { $repo: repo },
    );
    const rows = [...(res.data.chunks ?? []), ...(res.data.suites ?? [])];

    return [...new Set(rows.map((row) => row.path as string))];
  });
}

/** One test file's rows beyond `kept`, garbage-collected and then deleted; a file with nothing to remove prunes nothing. */
async function pruneOneTestFile(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  filePath: string,
  kept: KeptRows,
): Promise<number> {
  const doomed = await queryFileSubtree(dgraph, scope, filePath, kept);

  if (!doomed) {
    return 0;
  }

  await gcCoveredNodes(dgraph, doomed);

  // Re-query uids before the atomic delete mutation — Dgraph only detects write-write conflicts, so this is the staleness guard.
  const target = await queryFileSubtree(dgraph, scope, filePath, kept);

  if (!target) {
    return 0;
  }

  await deleteSubtree(dgraph, scope, target);

  return target.chunkUids.length;
}

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

/** Everything rooted at one test file, in one scope. The reverse edges (`~Statement.validated_by`) are what make the delete complete — a chunk knows its coverage, but only the reverse direction finds the statements claiming it. */
const fileSubtreeQuery = (scope: TraceScope): string =>
  `query q($repo: string, $file: string) {
        chunks(func: eq(TestChunk.repo, $repo))
            @filter(eq(TestChunk.file_path, $file)) {
          uid
          xid: TestChunk.xid
          stmts: ~Statement.validated_by { uid }
          acs: ~AcceptanceCriterion.validated_by { uid }
          covOut: TestChunk.coverage { uid covered: Coverage.covers { uid } }
        }
        suites(func: eq(TestSuite.repo, $repo))
            @filter(eq(TestSuite.file_path, $file)) { uid xid: TestSuite.xid }
        root(func: eq(${scope.rootType}.xid, $repo)) { uid }
      }`;

async function queryFileSubtree(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  filePath: string,
  kept: KeptRows,
): Promise<DoomedFile | null> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(fileSubtreeQuery(scope), {
      $repo: scope.key,
      $file: filePath,
    });

    return parseFileSubtreeResponse(res, kept);
  });
}

interface SubtreeResponse {
  data: Record<string, Record<string, unknown>[] | undefined>;
}

interface DoomedChunkRow {
  uid: string;
  xid: string;
  stmts?: UidRef[];
  acs?: UidRef[];
  covOut?: { uid: string; covered?: UidRef[] }[];
}

/** The doomed subtree of one test file, or null when nothing of it is doomed. */
function parseFileSubtreeResponse(
  res: SubtreeResponse,
  kept: KeptRows,
): DoomedFile | null {
  const chunks = rowsBeyond<DoomedChunkRow>(res.data.chunks, kept.chunkXids);
  const suites = rowsBeyond<UidRef & { xid: string }>(
    res.data.suites,
    kept.suiteXids,
  );

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

/** The rows of a queried list that `kept` does not name. */
function rowsBeyond<T extends { xid: string }>(
  rows: unknown,
  kept: Set<string>,
): T[] {
  return ((rows ?? []) as T[]).filter((row) => !kept.has(row.xid));
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

/** `TestChunk.coverage` is the only live chunk→Coverage edge; `Coverage.test` is unwritten dead schema. */
function collectCoverageUids(chunks: DoomedChunkRow[]): {
  coverageUids: string[];
  coveredUids: string[];
} {
  const allCovOuts = chunks.flatMap((chunk) => chunk.covOut ?? []);

  return {
    coverageUids: [...new Set(allCovOuts.map((covOut) => covOut.uid))],
    coveredUids: [
      ...new Set(
        allCovOuts.flatMap((covOut) =>
          (covOut.covered ?? []).map((coveredRef) => coveredRef.uid),
        ),
      ),
    ],
  };
}

/** The `[owner, chunk]` pairs to delete, one per node claiming this chunk. */
function edgesFromOwners(
  owners: UidRef[] | undefined,
  chunkUid: string,
): Array<[string, string]> {
  return (owners ?? []).map((owner): [string, string] => [owner.uid, chunkUid]);
}

/** The Repo anchor uid, or null when the repo has no graph node to detach the subtree from. */
function rootUidOf(root: UidRef[] | undefined): string | null {
  return root?.[0]?.uid ?? null;
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

/** The atomic delete mutation for one already-GC'd file subtree. */
async function deleteSubtree(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  target: FileSubtree,
): Promise<void> {
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      deleteNquads: deleteNquadsFor(scope, target).join("\n"),
      commitNow: true,
    }),
  );
}

/** Deletes the graph subtree of each named test file; a file with no graph presence is a no-op, so a re-driven or overlapping prune converges. */
type FileSubtree = NonNullable<Awaited<ReturnType<typeof queryFileSubtree>>>;

/** Everything a pruned test file takes with it: its chunks, suites and coverage rows, AND every edge pointing at them — a Statement left claiming `validated_by` a deleted chunk would still read as coverage. */
function deleteNquadsFor(scope: TraceScope, target: FileSubtree): string[] {
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
    deletes.push(...rootEdgeDeletes(scope, target, target.rootUid));
  }

  return deletes;
}

/** The root's back-edges go too, or the Repo or Overlay keeps a list of uids that resolve to nothing. */
function rootEdgeDeletes(
  scope: TraceScope,
  target: FileSubtree,
  rootUid: string,
): string[] {
  const edgesTo = (name: string, uids: string[]) =>
    uids.map((uid) => `<${rootUid}> <${rootEdge(scope, name)}> <${uid}> .`);

  return [
    ...edgesTo("test_chunks", target.chunkUids),
    ...edgesTo("test_suites", target.suiteUids),
    ...edgesTo("coverage", target.coverageUids),
  ];
}
