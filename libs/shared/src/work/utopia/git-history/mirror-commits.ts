// Mirrors one default-branch commit into the repo's Utopia knowledge base twice: as the standard text of the commit, pushed to the `git-history` source, and as the statements that name it, pushed to the identity source.

import { commitStatementItems } from "../../../domain/utopia/git-history/commit-statements.js";
import {
  commitDocument,
  type MirroredCommit,
} from "../../../domain/utopia/git-history/commit-text.js";
import {
  combineOutcomes,
  pushDocuments,
  pushItems,
  type DocumentMirrorDeps,
  type MirrorDeps,
  type MirrorOutcome,
} from "../push-items.js";

export async function mirrorCommit(
  deps: { text: DocumentMirrorDeps; statements: MirrorDeps },
  repo: string,
  commit: MirroredCommit,
): Promise<MirrorOutcome> {
  const [text, statements] = await Promise.all([
    pushDocuments(deps.text, [commitDocument(repo, commit)]),
    pushItems(deps.statements, commitStatementItems(repo, commit)),
  ]);

  return combineOutcomes(text, statements);
}
