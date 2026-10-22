// Mirrors a repo's tags and published releases into its Utopia knowledge base as their text, pushed to the `github` source.

import {
  releaseDocument,
  tagDocument,
  type ReleaseEntry,
  type TagEntry,
} from "../../../domain/utopia/github/release-text.js";
import {
  pushDocuments,
  type DocumentMirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export function mirrorTagsAndReleases(
  deps: DocumentMirrorDeps,
  repo: string,
  published: { tags: TagEntry[]; releases: ReleaseEntry[] },
): Promise<MirrorOutcome> {
  return pushDocuments(deps, [
    ...published.tags.map((tag) => tagDocument(repo, tag)),
    ...published.releases.map((release) => releaseDocument(repo, release)),
  ]);
}
