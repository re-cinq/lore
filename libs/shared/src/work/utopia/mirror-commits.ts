// Mirrors one default-branch commit into the repo's Utopia knowledge base: its items pushed four at a time as a document's are.

import {
  commitItems,
  type MirroredCommit,
} from "../../domain/utopia/commit-statements.js";
import {
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "./mirror-document.js";

export function mirrorCommit(
  deps: MirrorDeps,
  repo: string,
  commit: MirroredCommit,
): Promise<MirrorOutcome> {
  return pushItems(deps, commitItems(repo, commit));
}
