/** Shared lossless block projection: one Block node per {@link segmentBlocks} run (xid = `${repo}|${filePath}|block|${ordinal}`), the single authoritative writer used by both the spec and ADR layers; `Block.file_path` is set on every block so `recomputeFile` reconstructs any document uniformly, and callers own their own pruning. */

import { segmentBlocks } from "../../outbound/spec-trace/deps.js";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  upsertByXid,
  withTxn,
} from "../../outbound/spec-trace/dgraph-upsert.js";

/** A document being projected: the repo and path that scope its nodes plus the markdown itself. */
export interface SourceDocument {
  repo: string;
  filePath: string;
  content: string;
}

/** One source block as produced by {@link segmentBlocks}. */
type DocumentBlock = ReturnType<typeof segmentBlocks>[number];

/** Upserts one Block per source block of `content`, always setting `Block.file_path` (+ the `Block.spec` edge when `specUid` is given); returns the valid Block xids for the caller's pruning sweep. */
export async function projectDocumentBlocks(
  dgraph: DgraphClientPort,
  { repo, filePath, content }: SourceDocument,
  specUid?: string,
): Promise<Set<string>> {
  const blocks = segmentBlocks(content);

  for (const block of blocks) {
    const xid = blockXid(repo, filePath, block.ordinal);

    await upsertByXid(
      dgraph,
      "Block",
      xid,
      blockFields(repo, filePath, block, specUid),
    );
  }

  return new Set(
    blocks.map((block) => blockXid(repo, filePath, block.ordinal)),
  );
}

/** The type-namespaced xid identifying one Block of a document by its ordinal. */
function blockXid(repo: string, filePath: string, ordinal: number): string {
  return `${repo}|${filePath}|block|${ordinal}`;
}

/** The Block node's own predicates; the `Block.spec` edge and `Block.level` are omitted rather than nulled when absent. */
function blockFields(
  repo: string,
  filePath: string,
  block: DocumentBlock,
  specUid: string | undefined,
): Record<string, unknown> {
  return {
    "Block.repo": repo,
    "Block.file_path": filePath,
    "Block.ordinal": block.ordinal,
    "Block.kind": block.kind,
    "Block.text": block.text,
    ...(specUid !== undefined ? { "Block.spec": { uid: specUid } } : {}),
    ...(block.level !== undefined ? { "Block.level": block.level } : {}),
  };
}

/** Deletes every Block scoped to `(filePath, repo)` not in `validXids` — the orphaned higher-ordinal blocks left when a shorter document re-projects over a longer one; the single authoritative sweep for every document layer (spec, ADR, …), needing no Spec parent since `Block.file_path` is set on every Block. */
export async function pruneOrphanBlocksByFile(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
  validXids: Set<string>,
): Promise<void> {
  const blocks = await readFileBlocks(dgraph, repo, filePath);
  const orphanUids = blocks
    .filter((block) => !validXids.has(block.xid))
    .map((block) => block.uid);

  if (!orphanUids.length) {
    return;
  }

  await withTxn(dgraph, async (txn) => {
    await txn.mutate({
      deleteNquads: orphanUids.map((uid) => `<${uid}> * * .`).join("\n"),
      commitNow: true,
    });
  });
}

/** Every Block scoped to `(repo, filePath)`, as uid + xid pairs. */
async function readFileBlocks(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<Array<{ uid: string; xid: string }>> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($fp: string, $repo: string) {
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)) { uid Block.xid }
      }`,
      { $fp: filePath, $repo: repo },
    );
    const blocks = (res.data.blocks ?? []) as Array<{
      uid: string;
      "Block.xid": string;
    }>;

    return blocks.map((block) => ({ uid: block.uid, xid: block["Block.xid"] }));
  });
}
