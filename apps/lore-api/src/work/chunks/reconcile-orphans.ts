import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import { pruneOrphanChunks, type PruneResult } from "./prune-orphans.js";

/** Reconcile a repo's chunk store against its own tree, read over the GitHub API rather than posted by the caller. The sweep that needed a checkout could only ever be run by hand, so the drift a rename leaves behind accumulated: 40% of this repo's indexed code paths were gone from the tree by 2026-09-09. */
export async function reconcileOrphanChunks(
  pool: Pool,
  repo: string,
  ref?: string,
): Promise<PruneResult | null> {
  const present = await readTree(repo, ref);

  // An unreadable or empty tree is a failed read, never an empty repo — pruning against it would delete everything the repo has.
  if (present.length === 0) {
    return null;
  }

  return pruneOrphanChunks(pool, repo, present);
}

/** The tree, or nothing. A refused or truncated GitHub read throws, and an exception here would surface as a 500 on a route that promises 502 — worse, it would read as "the sweep ran" to anything that only checks for absence of a crash. */
async function readTree(repo: string, ref?: string): Promise<string[]> {
  try {
    return await (await projectFor(repo)).repo.tree(ref);
  } catch (err) {
    console.warn(`[reconcile] could not read the tree for ${repo}:`, err);

    return [];
  }
}
