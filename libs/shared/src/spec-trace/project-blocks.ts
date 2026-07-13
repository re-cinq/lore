/**
 * spec-traceability-graph — shared lossless block projection.
 *
 * Both the spec and the ADR source layers project the same thing: one Block node
 * per {@link segmentBlocks} run (xid = `${repo}|${filePath}|block|${ordinal}`),
 * carrying its ordinal/kind/verbatim text (+ heading level). This is the single
 * authoritative writer for that idiom.
 *
 * `Block.file_path` is set on EVERY block so any document (spec, ADR, …) can be
 * reconstructed uniformly by file_path via `recomputeFile`. The spec path also
 * passes `specUid`, which adds the `Block.spec` uid edge so the spec→block
 * traversal (and its `~Block.spec` reverse-edge pruning) keeps working. Pruning
 * stays with the caller that owns the parent; this helper only writes.
 *
 * Returns the set of valid Block xids it wrote, so callers that prune orphans can
 * pass it straight to their sweep. Talks only through {@link upsertByXid}; never
 * imports the driver.
 */

import { segmentBlocks } from "./deps.js";
import type { DgraphClientPort } from "./deps.js";
import { upsertByXid, withTxn } from "./dgraph-upsert.js";

/**
 * Upserts one Block per source block of `content`. Always sets `Block.file_path`;
 * additionally sets the `Block.spec` edge when `specUid` is given. Returns the
 * valid Block xids for the caller's pruning sweep.
 */
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

/**
 * Deletes every Block scoped to `(filePath, repo)` whose xid is not in
 * `validXids` — the orphaned higher-ordinal blocks left behind when a shorter
 * document re-projects over a longer one. The single authoritative Block sweep
 * for every document layer (spec, ADR, …): because {@link projectDocumentBlocks}
 * sets `Block.file_path` on every Block, the `(Block.file_path, Block.repo)`
 * index reaches them all without needing a Spec parent — so ADRs (which have no
 * Spec) and specs alike prune through this one function.
 */
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
