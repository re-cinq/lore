// Mirrors one issue or pull request into the repo's Utopia knowledge base as its text, pushed to the `github` source.

import {
  trackerDocument,
  type TrackedEntry,
} from "../../../domain/utopia/github/tracker-text.js";
import {
  pushDocuments,
  type DocumentMirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export function mirrorTrackedEntry(
  deps: DocumentMirrorDeps,
  repo: string,
  entry: TrackedEntry,
): Promise<MirrorOutcome> {
  return pushDocuments(deps, [trackerDocument(repo, entry)]);
}
