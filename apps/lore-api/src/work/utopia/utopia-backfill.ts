// Mirrors every spec, ADR and other markdown document on a repo's default branch into its Utopia knowledge base, for documents ingested before the mirror existed: the files CI ingests, read at the branch's head commit and pushed through the mirror an ingest uses. The branch's commits above the stored cursor follow them, then the issues and pull requests updated since theirs, then the tags and releases, then the repo's memories and episodes.

import { errorMessage, mapWithLimit } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { mirrorDocument } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import {
  mirrorFailure,
  type MirrorDeps,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/push-items.js";
import { mirrorCommit } from "@re-cinq/lore-shared/utopia/mirror-commits.js";
import { mirrorTrackedEntry } from "@re-cinq/lore-shared/utopia/mirror-tracker.js";
import { mirrorTagsAndReleases } from "@re-cinq/lore-shared/utopia/mirror-releases.js";
import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import type { Pool } from "pg";
import type { UtopiaBackfillSummary } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { projectFor } from "../../outbound/project-boot.js";
import {
  saveUtopiaCommitsHead,
  saveUtopiaTrackerSince,
} from "../../outbound/utopia-sources.js";
import {
  docsToMirror,
  INGEST_MANIFEST_PATH,
  type DocToMirror,
} from "./ingested-docs.js";
import {
  mirrorBranchCommits,
  type CommitHistoryDeps,
} from "./git-history/utopia-commits.js";
import { mirrorTracker, type TrackerDeps } from "./utopia-tracker.js";
import { mirrorReleases, type ReleaseDeps } from "./utopia-releases.js";
import {
  memoryWalkDepsFor,
  mirrorMemoryBacklog,
  type MemoryWalkDeps,
} from "./memory/utopia-memory.js";
import { repoMirrorDeps, type MirroredDoc } from "./utopia-mirror.js";

export interface BackfillFiles {
  defaultBranch(): Promise<string>;
  headSha(branch: string): Promise<string>;
  tree(ref: string): Promise<string[]>;
  read(path: string, ref: string): Promise<string | null>;
}

export interface BackfillDeps {
  files: BackfillFiles;
  mirror(doc: MirroredDoc): Promise<MirrorOutcome>;
  /** The default branch's commits above the stored cursor, pushed after the documents (FR12). */
  history: CommitHistoryDeps;
  /** The issues and pull requests updated since the stored cursor, pushed after the commits (FR14). */
  tracker: TrackerDeps;
  /** The repo's tags and published releases, pushed after the tracker walk (FR15). */
  releases: ReleaseDeps;
  /** The repo's memories and episodes above their cursors, pushed after the releases (FR16). */
  memory: MemoryWalkDeps;
}

type DocResult = Pick<MirrorOutcome, "created" | "updated" | "unchanged"> & {
  failure: string | null;
};

export const CONCURRENCY = 2;
const NOTHING_LANDED = { created: 0, updated: 0, unchanged: 0 };

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

async function backfillDocuments(
  deps: BackfillDeps,
  branch: string,
): Promise<UtopiaBackfillSummary> {
  const { files } = deps;
  const commit = await files.headSha(branch);
  const docs = docsToMirror(
    await files.tree(commit),
    await files.read(INGEST_MANIFEST_PATH, commit),
  );
  const results = await mapWithLimit(docs, CONCURRENCY, (doc) =>
    backfillDoc(deps, { ...doc, commit }),
  );
  const nothing = { ...NOTHING_LANDED, failed: [] };

  return results.reduce(tally, { commit, documents: docs.length, ...nothing });
}

async function backfillDoc(
  deps: BackfillDeps,
  doc: DocToMirror & { commit: string },
): Promise<DocResult> {
  try {
    const content = await deps.files.read(doc.path, doc.commit);

    enforceTrue(content !== null, Error, `not found at ${doc.commit}`);
    const outcome = await deps.mirror({ ...doc, content });
    const failure = mirrorFailure(outcome);

    return { ...outcome, failure: failure && `${doc.path}: ${failure}` };
  } catch (error) {
    const failure = `${doc.path}: ${errorMessage(error)}`;

    return { ...NOTHING_LANDED, failure };
  }
}

function tally(
  summary: UtopiaBackfillSummary,
  result: DocResult,
): UtopiaBackfillSummary {
  return {
    ...summary,
    created: summary.created + result.created,
    updated: summary.updated + result.updated,
    unchanged: summary.unchanged + result.unchanged,
    failed: result.failure
      ? [...summary.failed, result.failure]
      : summary.failed,
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
  const walks: WalkSource = { pool, repo, mirror, files, settings };

  return {
    files,
    mirror: (doc) => mirrorDocument(mirror, { repo, ...doc }),
    history: commitHistoryDepsFor(walks),
    tracker: trackerDepsFor(walks),
    releases: releaseDepsFor(walks),
    memory: memoryWalkDepsFor(pool, { name: repo, repo: true }),
  };
}

/** What the walks read and write through: the repo's GitHub reads, its settings, where the cursors are saved, and its source. */
interface WalkSource {
  pool: Pool;
  repo: string;
  mirror: MirrorDeps;
  files: CommitHistoryDeps["history"] &
    TrackerDeps["tracker"] &
    ReleaseDeps["published"];
  settings: { rawSettings(): Promise<Record<string, unknown> | null> };
}

function commitHistoryDepsFor(source: WalkSource): CommitHistoryDeps {
  const { pool, repo, mirror } = source;

  return {
    repo,
    history: source.files,
    cursor: {
      read: () => storedCursor(source, "commits_head"),
      write: (sha) => saveUtopiaCommitsHead(pool, repo, sha),
    },
    mirror: (commit) => mirrorCommit(mirror, repo, commit),
  };
}

function trackerDepsFor(source: WalkSource): TrackerDeps {
  const { pool, repo, mirror } = source;

  return {
    repo,
    tracker: source.files,
    cursor: {
      read: () => storedCursor(source, "tracker_since"),
      write: (since) => saveUtopiaTrackerSince(pool, repo, since),
    },
    mirror: (entry) => mirrorTrackedEntry(mirror, repo, entry),
  };
}

function releaseDepsFor(source: WalkSource): ReleaseDeps {
  const { repo, mirror } = source;

  return {
    repo,
    published: source.files,
    mirror: (published) => mirrorTagsAndReleases(mirror, repo, published),
  };
}

async function storedCursor(
  source: WalkSource,
  key: "commits_head" | "tracker_since",
): Promise<string | null> {
  const settings = await source.settings.rawSettings();
  const parsed = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  return parsed.success ? (parsed.data[key] ?? null) : null;
}
