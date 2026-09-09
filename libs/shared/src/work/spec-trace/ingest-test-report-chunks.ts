/** The test-report ingest's node layer: projects each descriptor into TestSuite/TestChunk nodes and hangs the whole layer off the Repo root. */

import type {
  DgraphClientPort,
  TestDescriptor,
} from "../../outbound/spec-trace/deps.js";
import { upsertByXid } from "../../outbound/spec-trace/dgraph-upsert.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";

/** A descriptor paired with its own per-`it` TestChunk uid and the file-scoped TestChunk uid that owns coverage (`validated_by` targets the latter). */
export interface DescriptorChunk {
  descriptor: TestDescriptor;
  testChunkUid: string;
  fileChunkUid: string;
}

/** Per-report accumulators an ingested descriptor folds into: the file-scoped TestChunk cache plus the Repo-root edge sets. */
interface DescriptorIngestState {
  fileChunkUidByFile: Map<string, string>;
  repoTestChunkUids: Set<string>;
  repoSuiteUids: Set<string>;
}

/** The node fields for one level of a suite chain; `parent` is spread in only when there is a level above it. */
function suiteFields(
  repo: string,
  descriptor: TestDescriptor,
  name: string | undefined,
  parentUid: string | undefined,
) {
  return {
    "TestSuite.repo": repo,
    "TestSuite.name": name,
    "TestSuite.file_path": descriptor.file,
    ...(parentUid ? { "TestSuite.parent": { uid: parentUid } } : {}),
  };
}

/** Projects the descriptor's suite chain as a parent-linked spine of TestSuite nodes, returning the innermost uid; undefined when the descriptor has no suite. */
async function projectSuiteChain(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
): Promise<string | undefined> {
  const suite = descriptor.suite ?? [];
  let parentUid: string | undefined;

  for (let i = 0; i < suite.length; i += 1) {
    parentUid = await upsertByXid(
      dgraph,
      "TestSuite",
      `${repo}|${descriptor.file}|${suite.slice(0, i + 1).join(">")}`,
      suiteFields(repo, descriptor, suite[i], parentUid),
    );
  }

  return parentUid;
}

/** The node for ONE test. Line numbers are spread conditionally rather than written as null: a descriptor from a runner that cannot report them is a test with unknown bounds, and storing 0 would place it at the top of its file. */
async function upsertTestChunk(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
  suiteUid: string | undefined,
): Promise<string> {
  return upsertByXid(dgraph, "TestChunk", `${repo}|${descriptor.id}`, {
    "TestChunk.repo": repo,
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

/** Upserts the file-scoped TestChunk node; `test_name` is set to the file path so the file-level coverage record attaches here rather than creating a second node. */
async function upsertFileChunk(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
): Promise<string> {
  return upsertByXid(dgraph, "TestChunk", fileScopedTestChunkXid(repo, file), {
    "TestChunk.repo": repo,
    "TestChunk.file_path": file,
    "TestChunk.test_name": file,
  });
}

/** The file-scoped TestChunk that OWNS coverage. `validated_by` targets this one so the chain reconverges on a single node per file. Memoized per run: every test in a file resolves to the same uid. */
async function fileScopedChunk(
  dgraph: DgraphClientPort,
  repo: string,
  file: string,
  state: DescriptorIngestState,
): Promise<string> {
  const cached = state.fileChunkUidByFile.get(file);

  if (cached !== undefined) {
    return cached;
  }
  const uid = await upsertFileChunk(dgraph, repo, file);

  state.fileChunkUidByFile.set(file, uid);

  return uid;
}

/** Upserts one descriptor's per-`it` + file-scoped TestChunks (caching the latter per file) and folds both into the Repo-root edge set. */
async function upsertDescriptorChunks(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
  ctx: { suiteUid: string | undefined; state: DescriptorIngestState },
): Promise<DescriptorChunk> {
  const { suiteUid, state } = ctx;
  const { file } = descriptor;
  const testChunkUid = await upsertTestChunk(
    dgraph,
    repo,
    descriptor,
    suiteUid,
  );
  const fileChunkUid = await fileScopedChunk(dgraph, repo, file, state);

  state.repoTestChunkUids.add(testChunkUid);
  state.repoTestChunkUids.add(fileChunkUid);

  return { descriptor, testChunkUid, fileChunkUid };
}

async function ingestDescriptorChunk(
  dgraph: DgraphClientPort,
  repo: string,
  descriptor: TestDescriptor,
  state: DescriptorIngestState,
): Promise<DescriptorChunk> {
  const suiteUid = await projectSuiteChain(dgraph, repo, descriptor);

  if (suiteUid) {
    state.repoSuiteUids.add(suiteUid);
  }

  return upsertDescriptorChunks(dgraph, repo, descriptor, { suiteUid, state });
}

/** A Repo edge as a uid list, or nothing at all when the set is empty — an edge nobody contributed to is left untouched rather than written blank. */
function repoEdge(predicate: string, uids: Set<string>) {
  return uids.size ? { [predicate]: [...uids].map((uid) => ({ uid })) } : {};
}

/** Attach every TestChunk + leaf TestSuite to the Repo root so the test layer is reachable; set-union dedups across re-ingests. */
async function attachTestLayerToRepo(
  dgraph: DgraphClientPort,
  repo: string,
  state: DescriptorIngestState,
): Promise<void> {
  await upsertByXid(dgraph, "Repo", repo, {
    ...repoEdge("Repo.test_chunks", state.repoTestChunkUids),
    ...repoEdge("Repo.test_suites", state.repoSuiteUids),
  });
}

/** Projects every descriptor into the graph and hangs the whole test layer off the Repo root. The shared state is what makes one file's tests converge on one file-scoped chunk, and the root attachment is what keeps the layer reachable — a node the entry point cannot reach is a node no query returns. */
export async function projectDescriptors(
  dgraph: DgraphClientPort,
  repo: string,
  descriptors: TestDescriptor[],
): Promise<DescriptorChunk[]> {
  const state: DescriptorIngestState = {
    fileChunkUidByFile: new Map(),
    repoTestChunkUids: new Set(),
    repoSuiteUids: new Set(),
  };
  const entries: DescriptorChunk[] = [];

  for (const descriptor of descriptors) {
    entries.push(await ingestDescriptorChunk(dgraph, repo, descriptor, state));
  }
  await attachTestLayerToRepo(dgraph, repo, state);

  return entries;
}
