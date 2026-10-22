// Mirrors a repo's tags and published releases into its Utopia knowledge base: every item pushed four at a time as a document's are.

import {
  releaseItems,
  tagItems,
  type ReleaseEntry,
  type TagEntry,
} from "../../domain/utopia/release-statements.js";
import {
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "./push-items.js";

export function mirrorTagsAndReleases(
  deps: MirrorDeps,
  repo: string,
  published: { tags: TagEntry[]; releases: ReleaseEntry[] },
): Promise<MirrorOutcome> {
  return pushItems(deps, [
    ...published.tags.flatMap((tag) => tagItems(repo, tag)),
    ...published.releases.flatMap((release) => releaseItems(repo, release)),
  ]);
}
