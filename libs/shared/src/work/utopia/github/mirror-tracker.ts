// Mirrors one issue or pull request into the repo's Utopia knowledge base: its items pushed four at a time as a document's are.

import {
  trackerItems,
  type TrackedEntry,
} from "../../../domain/utopia/github/tracker-statements.js";
import {
  pushItems,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export function mirrorTrackedEntry(
  deps: MirrorDeps,
  repo: string,
  entry: TrackedEntry,
): Promise<MirrorOutcome> {
  return pushItems(deps, trackerItems(repo, entry));
}
