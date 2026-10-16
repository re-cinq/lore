// Mirrors every spec and ADR on a repo's default branch into its Utopia knowledge base, for documents ingested before the mirror existed: the files CI ingests, read at the branch's head commit and pushed through the mirror an ingest uses. The branch's commits above the stored cursor follow them.

import { errorMessage, mapWithLimit } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  mirrorDocument,
  type MirrorDeps,
  type MirrorOutcome,
} from "@re-cinq/lore-shared/utopia/mirror-document.js";
import { mirrorCommit } from "@re-cinq/lore-shared/utopia/mirror-commits.js";
import { UtopiaMirrorSettingsSchema } from "@re-cinq/lore-shared/models/repo-settings.js";
import type { Pool } from "pg";
import type { UtopiaBackfillSummary } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { projectFor } from "../../outbound/project-boot.js";
import { saveUtopiaCommitsHead } from "../../outbound/utopia-sources.js";
import {
  docsToMirror,
  INGEST_MANIFEST_PATH,
  type DocToMirror,
} from "./ingested-docs.js";
import {
  mirrorBranchCommits,
  type CommitHistoryDeps,
} from "./utopia-commits.js";
import {
  mirrorFailure,
  repoMirrorDeps,
  type MirroredDoc,
} from "./utopia-mirror.js";

export interface BackfillFiles {
  defaultBranch(): Promise<string>;
  headSha(branch: string): Promise<string>;
  tree(ref: string): Promise<string[]>;
  read(path: string, ref: string): Promise<string | null>;
}

export interface BackfillDeps {
  files: BackfillFiles;
  mirror(doc: MirroredDoc): Promise<MirrorOutcome>;
  /** The default branch's commits above the stored cursor, pushed after the documents (FR11). */
  history: CommitHistoryDeps;
}

type DocResult = Pick<MirrorOutcome, "created" | "updated" | "unchanged"> & {
  failure: string | null;
};

export const CONCURRENCY = 2;
const NOTHING_LANDED = { created: 0, updated: 0, unchanged: 0 };

export async function backfillRepo(
  deps: BackfillDeps,
): Promise<UtopiaBackfillSummary> {
  const branch = await deps.files.defaultBranch();
  const documents = await backfillDocuments(deps, branch);

  return {
    ...documents,
    commits: await mirrorBranchCommits(deps.history, branch),
  };
}

async function backfillDocuments(
  deps: BackfillDeps,
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
  deps: BackfillDeps,
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

/** GitHub reads and the mirror for the repo's source, set up first where the deployment may; null when the repo has no source and the deployment cannot set one up. */
export async function backfillDepsFor(
  pool: Pool,
  repo: string,
): Promise<BackfillDeps | null> {
  const mirror = await repoMirrorDeps(pool, repo);

  if (!mirror) {
    return null;
  }
  const { repo: files, settings } = await projectFor(repo);

  return {
    files,
    mirror: (doc) => mirrorDocument(mirror, { repo, ...doc }),
    history: commitHistoryDepsFor(pool, repo, mirror, { files, settings }),
  };
}

function commitHistoryDepsFor(
  pool: Pool,
  repo: string,
  mirror: MirrorDeps,
  project: {
    files: CommitHistoryDeps["history"];
    settings: { rawSettings(): Promise<Record<string, unknown> | null> };
  },
): CommitHistoryDeps {
  return {
    history: project.files,
    cursor: {
      read: async () => commitsHeadOf(await project.settings.rawSettings()),
      write: (sha) => saveUtopiaCommitsHead(pool, repo, sha),
    },
    mirror: (commit) => mirrorCommit(mirror, repo, commit),
  };
}

function commitsHeadOf(
  settings: Record<string, unknown> | null,
): string | null {
  const parsed = UtopiaMirrorSettingsSchema.safeParse(settings?.utopia);

  return parsed.success ? (parsed.data.commits_head ?? null) : null;
}
