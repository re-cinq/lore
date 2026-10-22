// Mirrors one default-branch commit into the repo's Utopia knowledge base as the standard text of the commit, pushed to the `git-history` source.

import {
  commitDocument,
  type MirroredCommit,
} from "../../../domain/utopia/git-history/commit-text.js";
import {
  pushDocuments,
  type DocumentMirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export function mirrorCommit(
  deps: DocumentMirrorDeps,
  repo: string,
  commit: MirroredCommit,
): Promise<MirrorOutcome> {
  return pushDocuments(deps, [commitDocument(repo, commit)]);
}
