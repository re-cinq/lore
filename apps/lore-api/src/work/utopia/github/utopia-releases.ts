// Mirrors a repo's tags and published releases into its Utopia knowledge base. A repo has few, and an unchanged item answers unchanged, so every push sends them all: no cursor, and a refused item is sent again next time.

import { errorMessage } from "@re-cinq/lore-shared";
import type {
  ReleaseEntry,
  TagEntry,
} from "@re-cinq/lore-shared/utopia/release-statements.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import type { UtopiaReleasesSummary } from "@re-cinq/lore-shared/utopia/releases-summary.js";
import { mirrorTagsAndReleases } from "@re-cinq/lore-shared/utopia/mirror-releases.js";
import { queuedPerRepo } from "../cursor-walk.js";
import type { WalkSource } from "../walk-source.js";

export interface PublishedRefs {
  tags: TagEntry[];
  releases: ReleaseEntry[];
}

export interface ReleaseDeps {
  repo: string;
  published: {
    tags(): Promise<TagEntry[]>;
    releases(): Promise<ReleaseEntry[]>;
  };
  mirror(published: PublishedRefs): Promise<MirrorOutcome>;
}

export function mirrorReleases(
  deps: ReleaseDeps,
): Promise<UtopiaReleasesSummary> {
  return queuedPerRepo(deps.repo, () => pushAll(deps));
}

async function pushAll(deps: ReleaseDeps): Promise<UtopiaReleasesSummary> {
  const [tags, releases] = await Promise.all([
    deps.published.tags(),
    deps.published.releases(),
  ]);
  const read = { tags: tags.length, releases: releases.length };

  try {
    const { created, updated, unchanged, failed } = await deps.mirror({
      tags,
      releases,
    });

    return { ...read, created, updated, unchanged, failed };
  } catch (error) {
    const failed = [`releases: ${errorMessage(error)}`];

    return { ...read, created: 0, updated: 0, unchanged: 0, failed };
  }
}

export function releaseDepsFor(
  source: WalkSource<ReleaseDeps["published"]>,
): ReleaseDeps {
  const { repo, mirror } = source;

  return {
    repo,
    published: source.files,
    mirror: (published) => mirrorTagsAndReleases(mirror, repo, published),
  };
}
