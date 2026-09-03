import type { ChunksPort } from "@re-cinq/lore-shared";

export interface VerifyResult {
  touched: number;
  pruned: number;
  /** Distinct file paths whose chunks were pruned (audit trail for hard DELETE). */
  prunedFiles: string[];
}

/** Files stamped within N days are skipped; must stay below gap-detect's 90-day stale window. */
const TOUCH_MIN_AGE_DAYS = 30;

/** Post-reindex verification: re-stamps `ingested_at` and prunes reindex-owned chunks of vanished files. */
export async function verifyRepoChunks(
  port: ChunksPort,
  schema: string,
  repo: string,
  treePaths: string[],
): Promise<VerifyResult> {
  if (treePaths.length === 0) {
    return { touched: 0, pruned: 0, prunedFiles: [] };
  }

  const owned = await port.reindexOwnedFilePaths(schema, repo);
  const tree = new Set(treePaths);
  const present = owned.filter((path) => tree.has(path));
  const missing = owned.filter((path) => !tree.has(path));

  const touched =
    present.length > 0
      ? await port.touchChunksForFiles(
          schema,
          repo,
          present,
          TOUCH_MIN_AGE_DAYS,
        )
      : 0;
  const pruned =
    missing.length > 0
      ? await port.pruneChunksForFiles(schema, repo, missing)
      : 0;

  return { touched, pruned, prunedFiles: pruned > 0 ? missing : [] };
}
