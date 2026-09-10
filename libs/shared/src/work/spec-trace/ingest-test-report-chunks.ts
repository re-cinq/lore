/** The test-report ingest's node layer: projects each descriptor into TestSuite/TestChunk nodes and hangs the whole layer off the scope's root. */

import type {
  DgraphClientPort,
  TestDescriptor,
} from "../../outbound/spec-trace/deps.js";
import { upsertByXid } from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  rootEdge,
  scopedXid,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";

/** A descriptor paired with its own per-`it` TestChunk uid and the file-scoped TestChunk uid that owns coverage (`validated_by` targets the latter). */
export interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
  fileChunkUid: string;
}

/** Per-report accumulators an ingested descriptor folds into: the file-scoped TestChunk cache plus the root edge sets. */
interface DescriptorIngestState {
  fileChunkUidByFile: Map<string, string>;
  repoTestChunkUids: Set<string>;
  repoSuiteUids: Set<string>;
}

/** Projects every descriptor into the graph and hangs the whole test layer off the scope's root. The shared state is what makes one file's tests converge on one file-scoped chunk, and the root attachment is what keeps the layer reachable — a node the entry point cannot reach is a node no query returns. */
export async function projectDescriptors(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptors: TestDescriptor[],
): Promise<DescriptorChunk[]> {
  const state: DescriptorIngestState = {
    fileChunkUidByFile: new Map(),
    repoTestChunkUids: new Set(),
    repoSuiteUids: new Set(),
  };
  const entries: DescriptorChunk[] = [];

  for (const descriptor of descriptors) {
    entries.push(await ingestDescriptorChunk(dgraph, scope, descriptor, state));
  }
  await attachTestLayerToRoot(dgraph, scope, state);

  return entries;
}

/** Attach every TestChunk + leaf TestSuite to the scope's root — the Repo node on main, the run's Overlay node on a branch — so the test layer is reachable; set-union dedups across re-ingests. */
async function attachTestLayerToRoot(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  state: DescriptorIngestState,
): Promise<void> {
  await upsertByXid(dgraph, scope.rootType, scope.key, {
    ...rootEdgeSet(rootEdge(scope, "test_chunks"), state.repoTestChunkUids),
    ...rootEdgeSet(rootEdge(scope, "test_suites"), state.repoSuiteUids),
  });
}

/** A root edge as a uid list, or nothing at all when the set is empty — an edge nobody contributed to is left untouched rather than written blank. */
function rootEdgeSet(predicate: string, uids: Set<string>) {
  return uids.size ? { [predicate]: [...uids].map((uid) => ({ uid })) } : {};
}

async function ingestDescriptorChunk(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptor: TestDescriptor,
  state: DescriptorIngestState,
): Promise<DescriptorChunk> {
  const suiteUid = await projectSuiteChain(dgraph, scope, descriptor);

  if (suiteUid) {
    state.repoSuiteUids.add(suiteUid);
  }

  return upsertDescriptorChunks(dgraph, scope, descriptor, { suiteUid, state });
}

/** Projects the descriptor's suite chain as a parent-linked spine of TestSuite nodes, returning the innermost uid; undefined when the descriptor has no suite. */
async function projectSuiteChain(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptor: TestDescriptor,
): Promise<string | undefined> {
  const suite = descriptor.suite ?? [];
  let parentUid: string | undefined;

  for (let i = 0; i < suite.length; i += 1) {
    parentUid = await upsertByXid(
      dgraph,
      "TestSuite",
      scopedXid(scope, descriptor.file, suite.slice(0, i + 1).join(">")),
      suiteFields(scope, descriptor, suite[i], parentUid),
    );
  }

  return parentUid;
}

/** The node fields for one level of a suite chain; `parent` is spread in only when there is a level above it. */
function suiteFields(
  scope: TraceScope,
  descriptor: TestDescriptor,
  name: string | undefined,
  parentUid: string | undefined,
) {
  return {
    "TestSuite.repo": scope.key,
    "TestSuite.name": name,
    "TestSuite.file_path": descriptor.file,
    ...(parentUid ? { "TestSuite.parent": { uid: parentUid } } : {}),
  };
}

/** Upserts one descriptor's per-`it` + file-scoped TestChunks (caching the latter per file) and folds both into the root edge set. */
async function upsertDescriptorChunks(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptor: TestDescriptor,
  ctx: { suiteUid: string | undefined; state: DescriptorIngestState },
): Promise<DescriptorChunk> {
  const { suiteUid, state } = ctx;
  const { file } = descriptor;
  const testChunkUid = await upsertTestChunk(
    dgraph,
    scope,
    descriptor,
    suiteUid,
  );
  const fileChunkUid = await fileScopedChunk(dgraph, scope, file, state);

  state.repoTestChunkUids.add(testChunkUid);
  state.repoTestChunkUids.add(fileChunkUid);

  return { descriptor, testChunkUid, fileChunkUid };
}

/** The file-scoped TestChunk that OWNS coverage. `validated_by` targets this one so the chain reconverges on a single node per file. Memoized per run: every test in a file resolves to the same uid. */
async function fileScopedChunk(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  file: string,
  state: DescriptorIngestState,
): Promise<string> {
  const cached = state.fileChunkUidByFile.get(file);

  if (cached !== undefined) {
    return cached;
  }
  const uid = await upsertFileChunk(dgraph, scope, file);

  state.fileChunkUidByFile.set(file, uid);

  return uid;
}

/** Upserts the file-scoped TestChunk node; `test_name` is set to the file path so the file-level coverage record attaches here rather than creating a second node. */
async function upsertFileChunk(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  file: string,
): Promise<string> {
  return upsertByXid(
    dgraph,
    "TestChunk",
    fileScopedTestChunkXid(scope.key, file),
    {
      "TestChunk.repo": scope.key,
      "TestChunk.file_path": file,
      "TestChunk.test_name": file,
    },
  );
}

/** The node for ONE test. Line numbers are spread conditionally rather than written as null: a descriptor from a runner that cannot report them is a test with unknown bounds, and storing 0 would place it at the top of its file. */
async function upsertTestChunk(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptor: TestDescriptor,
  suiteUid: string | undefined,
): Promise<string> {
  return upsertByXid(dgraph, "TestChunk", scopedXid(scope, descriptor.id), {
    "TestChunk.repo": scope.key,
    "TestChunk.test_name": descriptor.name,
    "TestChunk.file_path": descriptor.file,
    ...(descriptor.startLine !== undefined
      ? { "TestChunk.start_line": descriptor.startLine }
      : {}),
    ...(descriptor.endLine !== undefined
      ? { "TestChunk.end_line": descriptor.endLine }
      : {}),
    ...(suiteUid ? { "TestChunk.suite": { uid: suiteUid } } : {}),
  });
}
