// Mirrors every spec, ADR and other markdown document on a repo's default branch into its Utopia knowledge base, for documents ingested before the mirror existed. The branch's commits above the stored cursor follow them, then the issues and pull requests updated since theirs, then the tags and releases, then the repo's memories and episodes.

import { mirrorDocument } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import type { UtopiaBackfillSummary } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import type { Pool } from "pg";
import { projectFor } from "../../outbound/project-boot.js";
import {
  backfillDocuments,
  type DocBackfillDeps,
} from "./docs/backfill-docs.js";
import {
  commitHistoryDepsFor,
  mirrorBranchCommits,
  type CommitHistoryDeps,
} from "./git-history/utopia-commits.js";
import {
  mirrorTracker,
  trackerDepsFor,
  type TrackerDeps,
} from "./github/utopia-tracker.js";
import {
  mirrorReleases,
  releaseDepsFor,
  type ReleaseDeps,
} from "./github/utopia-releases.js";
import {
  memoryWalkDepsFor,
  mirrorMemoryBacklog,
  type MemoryWalkDeps,
} from "./memory/utopia-memory.js";
import { repoMirrorDeps } from "./repo-mirror.js";

export interface BackfillDeps extends DocBackfillDeps {
  /** The default branch's commits above the stored cursor, pushed after the documents (FR12). */
  history: CommitHistoryDeps;
  /** The issues and pull requests updated since the stored cursor, pushed after the commits (FR14). */
  tracker: TrackerDeps;
  /** The repo's tags and published releases, pushed after the tracker walk (FR15). */
  releases: ReleaseDeps;
  /** The repo's memories and episodes above their cursors, pushed after the releases (FR16). */
  memory: MemoryWalkDeps;
}

export async function backfillRepo(
  deps: BackfillDeps,
): Promise<UtopiaBackfillSummary> {
  const branch = await deps.files.defaultBranch();
  const documents = await backfillDocuments(deps, branch);
  const commits = await mirrorBranchCommits(deps.history, branch);
  const tracker = await mirrorTracker(deps.tracker);
  const releases = await mirrorReleases(deps.releases);
  const memory = await mirrorMemoryBacklog(deps.memory);
  const walks = [commits, tracker, releases, ...Object.values(memory)];

  return {
    ...documents,
    failed: [...documents.failed, ...walks.flatMap((walk) => walk.failed)],
    commits,
    tracker,
    releases,
    memory,
  };
}

/** GitHub reads and the mirror for the repo's source, set up first where the deployment may; null when the repo has no source and the deployment cannot set one up. */
export async function backfillDepsFor(
  pool: Pool,
  repo: string,
): Promise<BackfillDeps | null> {
  const mirror = await repoMirrorDeps(pool, repo);

  if (!mirror) {
    return null;
  }
  const { repo: files, settings } = await projectFor(repo);
  const walks = { pool, repo, mirror, files, settings };

  return {
    files,
    mirror: (doc) => mirrorDocument(mirror, { repo, ...doc }),
    history: commitHistoryDepsFor(walks),
    tracker: trackerDepsFor(walks),
    releases: releaseDepsFor(walks),
    memory: memoryWalkDepsFor(pool, { name: repo, repo: true }),
  };
}
