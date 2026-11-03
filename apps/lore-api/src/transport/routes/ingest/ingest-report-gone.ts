import { selectPruneCandidates } from "@re-cinq/lore-shared";
import type { IngestDeltaDeps } from "./ingest-delta-deps.js";

/** The part of a default-branch test-report delta that says which test files went away. */
export interface GoneTestsDelta {
  deleted?: string[];
  present?: string[];
}

/** The test files a delta takes out of the graph: the ones it names as deleted and, on a full ingest, the ones the tree no longer holds. */
export async function goneTestFiles(
  deps: IngestDeltaDeps,
  repo: string,
  delta: GoneTestsDelta,
): Promise<string[]> {
  const vanished = await vanishedTestFiles(deps, repo, delta.present ?? []);

  return [...new Set([...(delta.deleted ?? []), ...vanished])];
}

/** The graph's test files absent from the posted tree. Docs' fuse applies: a set that looks like a bad tree read (more than 2 files AND more than half of what the graph holds) prunes nothing and does not fail the ingest, and neither does an empty list. */
async function vanishedTestFiles(
  deps: IngestDeltaDeps,
  repo: string,
  present: string[],
): Promise<string[]> {
  if (present.length === 0) {
    return [];
  }
  const selection = selectPruneCandidates(
    await deps.listTests(repo),
    present,
    () => true,
  );

  if (selection.outcome === "ok") {
    return selection.candidates;
  }
  console.warn(`[ingest-delta] test-report ${repo}: ${refusalOf(selection)}`);

  return [];
}

function refusalOf(refused: {
  candidateCount: number;
  inScopeDocCount: number;
}): string {
  return `refusing to prune ${refused.candidateCount} of ${refused.inScopeDocCount} graph test files absent from the posted tree`;
}
