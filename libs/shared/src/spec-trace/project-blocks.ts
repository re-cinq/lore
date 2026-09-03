/** Shared lossless block projection: one Block node per {@link segmentBlocks} run (xid = `${repo}|${filePath}|block|${ordinal}`), the single authoritative writer used by both the spec and ADR layers; `Block.file_path` is set on every block so `recomputeFile` reconstructs any document uniformly, and callers own their own pruning. */

import { segmentBlocks } from "./deps.js";
import type { DgraphClientPort } from "./deps.js";
import { upsertByXid, withTxn } from "./dgraph-upsert.js";

/** Upserts one Block per source block of `content`, always setting `Block.file_path` (+ the `Block.spec` edge when `specUid` is given); returns the valid Block xids for the caller's pruning sweep. */
export async function projectDocumentBlocks(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
  content: string,
  specUid?: string,
): Promise<Set<string>> {
  const blocks = segmentBlocks(content);

  for (const block of blocks) {
    await upsertByXid(
      dgraph,
      "Block",
      `${repo}|${filePath}|block|${block.ordinal}`,
      {
        "Block.repo": repo,
        "Block.file_path": filePath,
        "Block.ordinal": block.ordinal,
        "Block.kind": block.kind,
        "Block.text": block.text,
        ...(specUid !== undefined ? { "Block.spec": { uid: specUid } } : {}),
        ...(block.level !== undefined ? { "Block.level": block.level } : {}),
      },
    );
  }

  return new Set(
    blocks.map((block) => `${repo}|${filePath}|block|${block.ordinal}`),
  );
}

/** Deletes every Block scoped to `(filePath, repo)` not in `validXids` — the orphaned higher-ordinal blocks left when a shorter document re-projects over a longer one; the single authoritative sweep for every document layer (spec, ADR, …), needing no Spec parent since `Block.file_path` is set on every Block. */
export async function pruneOrphanBlocksByFile(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
  validXids: Set<string>,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($fp: string, $repo: string) {
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)) { uid Block.xid }
      }`,
      { $fp: filePath, $repo: repo },
    );
    const blocks = (res.data?.blocks ?? []) as Array<{
      uid: string;
      "Block.xid": string;
    }>;
    const orphanUids = blocks
      .filter((block) => !validXids.has(block["Block.xid"]))
      .map((block) => block.uid);

    if (orphanUids.length) {
      await txn.mutate({
        deleteNquads: orphanUids.map((uid) => `<${uid}> * * .`).join("\n"),
        commitNow: true,
      });
    }
  });
}
