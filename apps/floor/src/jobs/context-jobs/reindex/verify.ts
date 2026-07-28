import type { ChunksPort } from "@re-cinq/lore-shared";

export interface VerifyResult {
  touched: number;
  pruned: number;
}

/**
 * Post-reindex verification pass: re-stamps `ingested_at` on the repo's
 * reindex-owned chunks whose files still exist in the repo tree, and prunes
 * reindex-owned chunks of files that vanished. Restricted to
 * `metadata->>'ingested_by' = 'reindex-job'` rows, so API- and UI-ingested
 * chunks are never touched or deleted. An empty tree is treated as a failed
 * fetch — no touch, no prune.
 */
export async function verifyRepoChunks(
  port: ChunksPort,
  schema: string,
  repo: string,
  treePaths: string[],
): Promise<VerifyResult> {
  if (treePaths.length === 0) {
    return { touched: 0, pruned: 0 };
  }

  const owned = await port.reindexOwnedFilePaths(schema, repo);
  const tree = new Set(treePaths);
  const present = owned.filter((path) => tree.has(path));
  const missing = owned.filter((path) => !tree.has(path));

  const touched =
    present.length > 0
      ? await port.touchChunksForFiles(schema, repo, present)
      : 0;
  const pruned =
    missing.length > 0
      ? await port.pruneChunksForFiles(schema, repo, missing)
      : 0;

  return { touched, pruned };
}
