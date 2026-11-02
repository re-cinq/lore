// Mirrors a repo's tags and published releases into its Utopia knowledge base twice: as their text, pushed to the releases source, and as the statements that name them, pushed to the identity source.

import {
  releaseStatementItems,
  tagStatementItems,
} from "../../../domain/utopia/github/release-statements.js";
import {
  releaseDocument,
  tagDocument,
  type ReleaseEntry,
  type TagEntry,
} from "../../../domain/utopia/github/release-text.js";
import {
  combineOutcomes,
  pushDocuments,
  pushItems,
  type DocumentMirrorDeps,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export async function mirrorTagsAndReleases(
  deps: { text: DocumentMirrorDeps; statements: MirrorDeps },
  repo: string,
  published: { tags: TagEntry[]; releases: ReleaseEntry[] },
): Promise<MirrorOutcome> {
  const [text, statements] = await Promise.all([
    pushDocuments(deps.text, [
      ...published.tags.map((tag) => tagDocument(repo, tag)),
      ...published.releases.map((release) => releaseDocument(repo, release)),
    ]),
    pushItems(deps.statements, [
      ...published.tags.flatMap((tag) => tagStatementItems(repo, tag)),
      ...published.releases.flatMap((release) =>
        releaseStatementItems(repo, release),
      ),
    ]),
  ]);

  return combineOutcomes(text, statements);
}
