// Mirrors one issue or pull request into the repo's Utopia knowledge base twice: as its text, pushed to the issues or pull-requests source, and as the statements that name it, pushed to the identity source.

import { trackedStatementItems } from "../../../domain/utopia/github/tracker-statements.js";
import {
  trackerDocument,
  type TrackedEntry,
} from "../../../domain/utopia/github/tracker-text.js";
import {
  combineOutcomes,
  pushDocuments,
  pushItems,
  type DocumentMirrorDeps,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export async function mirrorTrackedEntry(
  deps: { text: DocumentMirrorDeps; statements: MirrorDeps },
  repo: string,
  entry: TrackedEntry,
): Promise<MirrorOutcome> {
  const [text, statements] = await Promise.all([
    pushDocuments(deps.text, [trackerDocument(repo, entry)]),
    pushItems(deps.statements, trackedStatementItems(repo, entry)),
  ]);

  return combineOutcomes(text, statements);
}
