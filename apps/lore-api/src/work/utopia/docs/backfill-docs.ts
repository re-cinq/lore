// Mirrors every spec, ADR and other markdown document on a repo's default branch, for documents ingested before the mirror existed: the files CI ingests, read at the branch's head commit and pushed through the mirror an ingest uses.

import { errorMessage, mapWithLimit } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  mirrorFailure,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/push-items.js";
import type { UtopiaBackfillSummary } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import {
  docsToMirror,
  INGEST_MANIFEST_PATH,
  type DocToMirror,
} from "./ingested-docs.js";
import type { MirroredDoc } from "./mirror-doc.js";

export interface BackfillFiles {
  defaultBranch(): Promise<string>;
  headSha(branch: string): Promise<string>;
  tree(ref: string): Promise<string[]>;
  read(path: string, ref: string): Promise<string | null>;
}

export interface DocBackfillDeps {
  files: BackfillFiles;
  mirror(doc: MirroredDoc): Promise<MirrorOutcome>;
}

type DocResult = Pick<MirrorOutcome, "created" | "updated" | "unchanged"> & {
  failure: string | null;
};

export const CONCURRENCY = 2;
const NOTHING_LANDED = { created: 0, updated: 0, unchanged: 0 };

export async function backfillDocuments(
  deps: DocBackfillDeps,
  branch: string,
): Promise<UtopiaBackfillSummary> {
  const { files } = deps;
  const commit = await files.headSha(branch);
  const docs = docsToMirror(
    await files.tree(commit),
    await files.read(INGEST_MANIFEST_PATH, commit),
  );
  const results = await mapWithLimit(docs, CONCURRENCY, (doc) =>
    backfillDoc(deps, { ...doc, commit }),
  );
  const nothing = { ...NOTHING_LANDED, failed: [] };

  return results.reduce(tally, { commit, documents: docs.length, ...nothing });
}

async function backfillDoc(
  deps: DocBackfillDeps,
  doc: DocToMirror & { commit: string },
): Promise<DocResult> {
  try {
    const content = await deps.files.read(doc.path, doc.commit);

    enforceTrue(content !== null, Error, `not found at ${doc.commit}`);
    const outcome = await deps.mirror({ ...doc, content });
    const failure = mirrorFailure(outcome);

    return { ...outcome, failure: failure && `${doc.path}: ${failure}` };
  } catch (error) {
    const failure = `${doc.path}: ${errorMessage(error)}`;

    return { ...NOTHING_LANDED, failure };
  }
}

function tally(
  summary: UtopiaBackfillSummary,
  result: DocResult,
): UtopiaBackfillSummary {
  return {
    ...summary,
    created: summary.created + result.created,
    updated: summary.updated + result.updated,
    unchanged: summary.unchanged + result.unchanged,
    failed: result.failure
      ? [...summary.failed, result.failure]
      : summary.failed,
  };
}
