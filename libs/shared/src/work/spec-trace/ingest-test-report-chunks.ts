/** The test-report ingest's node layer: projects each descriptor into TestSuite/TestChunk nodes and hangs the whole layer off the scope's root. */

import type {
  DgraphClientPort,
  TestDescriptor,
} from "../../outbound/spec-trace/deps.js";
import { upsertByXid } from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  rootEdge,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";
import {
  fileScopedTestChunkXid,
  suiteLevelXid,
  testChunkXid,
} from "./test-chunk-identity.js";
import {
  isChunkUnchanged,
  isSuiteUnchanged,
  NO_STORED_TESTS,
  type PlannedChunk,
  type PlannedSuite,
  type StoredTestLayer,
} from "./stored-test-layer.js";

/** A descriptor paired with its own per-`it` TestChunk uid and the file-scoped TestChunk uid that owns coverage (`validated_by` targets the latter). */
export interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
  fileChunkUid: string;
}

/** Where one report's test layer is written, what the graph already holds for it, and the tests this report has written so far. */
interface TestLayerWrite {
  dgraph: DgraphClientPort;
  scope: TraceScope;
  stored: StoredTestLayer;
  seen: Set<string>;
}

/** Per-report accumulators an ingested descriptor folds into: the file-scoped TestChunk cache plus the root edge sets. */
interface DescriptorIngestState {
  fileChunkUidByFile: Map<string, string>;
  repoTestChunkUids: Set<string>;
  repoSuiteUids: Set<string>;
}

/** Projects every descriptor into the graph and hangs the whole test layer off the scope's root. The shared state is what makes one file's tests converge on one file-scoped chunk, and the root attachment is what keeps the layer reachable — a node the entry point cannot reach is a node no query returns. A suite or test `stored` already holds as written is not written again, but is still attached. */
export async function projectDescriptors(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  descriptors: TestDescriptor[],
  stored: StoredTestLayer = NO_STORED_TESTS,
): Promise<DescriptorChunk[]> {
  const layer: TestLayerWrite = { dgraph, scope, stored, seen: new Set() };
  const state: DescriptorIngestState = {
    fileChunkUidByFile: new Map(),
    repoTestChunkUids: new Set(),
    repoSuiteUids: new Set(),
  };
  const entries: DescriptorChunk[] = [];

  for (const descriptor of descriptors) {
    entries.push(await ingestDescriptorChunk(layer, descriptor, state));
  }
  await attachTestLayerToRoot(dgraph, scope, state);

  return entries;
}

/** Attach every TestChunk + leaf TestSuite to the scope's root — the Repo node on main, the branch's Overlay node otherwise — so the test layer is reachable; set-union dedups across re-ingests. */
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
  layer: TestLayerWrite,
  descriptor: TestDescriptor,
  state: DescriptorIngestState,
): Promise<DescriptorChunk> {
  const suiteUid = await projectSuiteChain(layer, descriptor);

  if (suiteUid) {
    state.repoSuiteUids.add(suiteUid);
  }

  return upsertDescriptorChunks(layer, descriptor, { suiteUid, state });
}

/** Projects the descriptor's suite chain as a parent-linked spine of TestSuite nodes, returning the innermost uid; undefined when the descriptor has no suite. */
async function projectSuiteChain(
  layer: TestLayerWrite,
  descriptor: TestDescriptor,
): Promise<string | undefined> {
  const suite = descriptor.suite ?? [];
  let parentUid: string | undefined;

  for (let level = 0; level < suite.length; level += 1) {
    parentUid = await suiteLevelUid(layer, descriptor, {
      level,
      parentUid,
    });
  }

  return parentUid;
}

/** The uid of one level of the chain: the stored one when the graph holds it as written, else the one the upsert writes. */
async function suiteLevelUid(
  { dgraph, scope, stored }: TestLayerWrite,
  descriptor: TestDescriptor,
  { level, parentUid }: { level: number; parentUid: string | undefined },
): Promise<string> {
  const xid = suiteLevelXid(scope, descriptor, level);
  const planned = {
    repo: scope.key,
    name: descriptor.suite?.[level],
    file: descriptor.file,
    parentUid,
  };
  const held = stored.suites.get(xid);

  if (held && isSuiteUnchanged(held, planned)) {
    return held.uid;
  }

  return upsertByXid(dgraph, "TestSuite", xid, suiteFields(planned));
}

/** The node fields for one level of a suite chain; `parent` is spread in only when there is a level above it. */
function suiteFields({ repo, name, file, parentUid }: PlannedSuite) {
  return {
    "TestSuite.repo": repo,
    "TestSuite.name": name,
    "TestSuite.file_path": file,
    ...(parentUid ? { "TestSuite.parent": { uid: parentUid } } : {}),
  };
}

/** Upserts one descriptor's per-`it` + file-scoped TestChunks (caching the latter per file) and folds both into the root edge set. */
async function upsertDescriptorChunks(
  layer: TestLayerWrite,
  descriptor: TestDescriptor,
  ctx: { suiteUid: string | undefined; state: DescriptorIngestState },
): Promise<DescriptorChunk> {
  const { suiteUid, state } = ctx;
  const { file } = descriptor;
  const testChunkUid = await upsertTestChunk(layer, descriptor, suiteUid);
  const fileChunkUid = await fileScopedChunk(layer, file, state);

  state.repoTestChunkUids.add(testChunkUid);
  state.repoTestChunkUids.add(fileChunkUid);

  return { descriptor, testChunkUid, fileChunkUid };
}

/** The file-scoped TestChunk that OWNS coverage. `validated_by` targets this one so the chain reconverges on a single node per file. Memoized per run: every test in a file resolves to the same uid. */
async function fileScopedChunk(
  layer: TestLayerWrite,
  file: string,
  state: DescriptorIngestState,
): Promise<string> {
  const cached = state.fileChunkUidByFile.get(file);

  if (cached !== undefined) {
    return cached;
  }
  const uid = await upsertFileChunk(layer, file);

  state.fileChunkUidByFile.set(file, uid);

  return uid;
}

/** Upserts the file-scoped TestChunk node; `test_name` is set to the file path so the file-level coverage record attaches here rather than creating a second node. */
async function upsertFileChunk(
  layer: TestLayerWrite,
  file: string,
): Promise<string> {
  const { key } = layer.scope;

  return keptOrUpsertedChunk(layer, fileScopedTestChunkXid(key, file), {
    repo: key,
    name: file,
    file,
  });
}

/** The node for ONE test. Line numbers are spread conditionally rather than written as null: a descriptor from a runner that cannot report them is a test with unknown bounds, and storing 0 would place it at the top of its file. */
async function upsertTestChunk(
  layer: TestLayerWrite,
  descriptor: TestDescriptor,
  suiteUid: string | undefined,
): Promise<string> {
  const { dgraph, scope, seen } = layer;
  const xid = testChunkXid(scope, descriptor.id);
  const planned = plannedTestChunk(scope, descriptor, suiteUid);

  // A test the report names twice is written again after the first time, so the last one wins, as when every test was written.
  if (seen.has(xid)) {
    return upsertByXid(dgraph, "TestChunk", xid, chunkFields(planned));
  }
  seen.add(xid);

  return keptOrUpsertedChunk(layer, xid, planned);
}

function plannedTestChunk(
  scope: TraceScope,
  descriptor: TestDescriptor,
  suiteUid: string | undefined,
): PlannedChunk {
  return {
    repo: scope.key,
    name: descriptor.name,
    file: descriptor.file,
    ...(descriptor.startLine !== undefined
      ? { start: descriptor.startLine }
      : {}),
    ...(descriptor.endLine !== undefined ? { end: descriptor.endLine } : {}),
    ...(suiteUid ? { suiteUid } : {}),
  };
}

/** The uid of a TestChunk: the stored one when the graph holds it as planned, else the one the upsert writes. */
async function keptOrUpsertedChunk(
  { dgraph, stored }: TestLayerWrite,
  xid: string,
  planned: PlannedChunk,
): Promise<string> {
  const held = stored.chunks.get(xid);

  if (held && isChunkUnchanged(held, planned)) {
    return held.uid;
  }

  return upsertByXid(dgraph, "TestChunk", xid, chunkFields(planned));
}

function chunkFields(planned: PlannedChunk) {
  return {
    "TestChunk.repo": planned.repo,
    "TestChunk.test_name": planned.name,
    "TestChunk.file_path": planned.file,
    ...(planned.start !== undefined
      ? { "TestChunk.start_line": planned.start }
      : {}),
    ...(planned.end !== undefined ? { "TestChunk.end_line": planned.end } : {}),
    ...(planned.suiteUid
      ? { "TestChunk.suite": { uid: planned.suiteUid } }
      : {}),
  };
}
