// Collects what a repository's next release carries on the external floor (specs/scheduled-releases): the head of the default branch is pinned, and what merged and closed since the last version tag leaves as the file the release agent reads.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import type { ChangelogChange } from "@re-cinq/lore-shared/models/changelog-week.js";
import type { ClosedWork } from "@re-cinq/lore-shared/changelog/changelog-week.js";
import { releaseChanges } from "@re-cinq/lore-shared/release/release-changes.js";
import type { TagEntry } from "@re-cinq/lore-shared/utopia/release-text.js";
import { collectDeps } from "../deps.js";
import {
  previousRelease,
  type ReleaseRange,
  releaseFile,
  releaseValues,
} from "./release-collected.js";

export interface CommitAt {
  sha: string;
  /** ISO committer time. */
  committedAt: string;
}

export interface ReleaseCollectDeps {
  head(repo: string): Promise<CommitAt>;
  /** The public mirror the repository publishes to, whose tags hold the releases made before it did; null when it names none. */
  mirror(repo: string): Promise<string | null>;
  tags(repo: string): Promise<TagEntry[]>;
  commit(repo: string, sha: string): Promise<CommitAt>;
  closedWork(repo: string, bounds: { from: string }): Promise<ClosedWork>;
}

export const NOT_A_RELEASE =
  "the run carries no repository: release_repo is needed";

const BEGINNING = new Date(0).toISOString();

/** `empty` when the last tag already sits on the head or nothing merged or closed since it; nothing is produced then. */
export function releaseCollectHandle(deps: ReleaseCollectDeps): Handle {
  return async (brief, tools) => {
    const { release_repo: repo } = brief.needs;

    if (typeof repo !== "string") {
      return { outcome: "failed", error: NOT_A_RELEASE };
    }

    try {
      const collected = await collectRelease(deps, repo);

      if (collected === null) {
        return { outcome: "empty" };
      }
      const file = releaseFile({ ...collected.release, repo, ...collected });

      await tools.produce("release_changes", Buffer.from(file));

      return { outcome: "success", produced: releaseValues(collected.release) };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

interface CollectedRelease {
  release: ReleaseRange & { sha: string };
  changes: ChangelogChange[];
}

async function collectRelease(
  deps: ReleaseCollectDeps,
  repo: string,
): Promise<CollectedRelease | null> {
  const head = await deps.head(repo);
  const previous = previousRelease(await releaseTags(deps, repo));

  if (previous?.sha === head.sha) {
    return null;
  }
  const range = await rangeOf(deps, repo, { previous, head });
  const changes = releaseChanges(
    await deps.closedWork(repo, { from: range.rangeFrom ?? BEGINNING }),
    { since: range.rangeFrom, until: range.rangeTo },
  );

  return changes.length === 0
    ? null
    : { release: { sha: head.sha, ...range }, changes };
}

async function releaseTags(
  deps: ReleaseCollectDeps,
  repo: string,
): Promise<TagEntry[]> {
  const mirror = await deps.mirror(repo);
  const owners = mirror === null ? [repo] : [repo, mirror];
  const tags = await Promise.all(owners.map((owner) => deps.tags(owner)));

  return tags.flat();
}

async function rangeOf(
  deps: ReleaseCollectDeps,
  repo: string,
  { previous, head }: { previous: TagEntry | null; head: CommitAt },
): Promise<ReleaseRange> {
  const previousCommit = previous && (await deps.commit(repo, previous.sha));

  return {
    previousTag: previous?.name ?? null,
    rangeFrom: previousCommit?.committedAt ?? null,
    rangeTo: head.committedAt,
  };
}

export function startReleaseCollectStation(): RunningStation {
  return defineStation("release-collect", releaseCollectHandle(collectDeps()));
}
