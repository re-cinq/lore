// Mirrors a repo's default-branch commits into its Utopia knowledge base: the branch's history above the cursor its settings hold, walked oldest-first, each commit pushed through the mirror an ingest uses and the cursor moved past it, so a walk that stops leaves the next one where it was.

import { errorMessage } from "@re-cinq/lore-shared";
import type {
  BranchHistoryOptions,
  CommitDetail,
} from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  ChangedFile,
  MirroredCommit,
} from "@re-cinq/lore-shared/utopia/commit-statements.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import type { UtopiaCommitsSummary } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { docsToMirror, INGEST_MANIFEST_PATH } from "./ingested-docs.js";
import { mirrorFailure } from "./utopia-mirror.js";

export interface CommitHistoryDeps {
  /** The walks of one repo run one after the other in this process: a second push during a walk waits for it, then finds what landed since. */
  repo: string;
  history: {
    branchHistory(
      branch: string,
      opts: BranchHistoryOptions,
    ): Promise<CommitDetail[]>;
    read(path: string, ref: string): Promise<string | null>;
  };
  cursor: {
    read(): Promise<string | null>;
    write(sha: string): Promise<void>;
  };
  mirror(commit: MirroredCommit): Promise<MirrorOutcome>;
}

/** One walk reads this many commits in detail at most, one GitHub call each; a longer history takes more walks, each resuming from the cursor. */
export const MAX_COMMITS_PER_RUN = 2000;

export function mirrorBranchCommits(
  deps: CommitHistoryDeps,
  branch: string,
): Promise<UtopiaCommitsSummary> {
  return queuedPerRepo(deps.repo, () => walkBranch(deps, branch));
}

const walking = new Map<string, Promise<unknown>>();

/** Two overlapping walks of one repo would each read the same commits and the later to finish would move the cursor back; so one waits for the other, whatever the other's outcome. */
function queuedPerRepo<T>(repo: string, start: () => Promise<T>): Promise<T> {
  const key = repo.toLowerCase();
  const ahead = walking.get(key) ?? Promise.resolve();
  const run = ahead.then(start, start);

  const release = () => {
    if (walking.get(key) === run) {
      walking.delete(key);
    }
  };

  walking.set(key, run);
  void run.then(release, release);

  return run;
}

async function walkBranch(
  deps: CommitHistoryDeps,
  branch: string,
): Promise<UtopiaCommitsSummary> {
  const from = await deps.cursor.read();
  const commits = await deps.history.branchHistory(branch, {
    ...(from === null ? {} : { until: from }),
    limit: MAX_COMMITS_PER_RUN,
  });
  const manifest =
    commits.length > 0
      ? await deps.history.read(INGEST_MANIFEST_PATH, branch)
      : null;

  return walk(deps, commits, manifest, nothingPushed(branch, from));
}

function nothingPushed(
  branch: string,
  from: string | null,
): UtopiaCommitsSummary {
  return {
    branch,
    from,
    to: null,
    commits: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: [],
  };
}

/** Oldest first; the cursor moves past each commit that landed whole, and the first that did not ends the walk. */
async function walk(
  deps: CommitHistoryDeps,
  commits: CommitDetail[],
  manifest: string | null,
  start: UtopiaCommitsSummary,
): Promise<UtopiaCommitsSummary> {
  let summary = start;

  for (const commit of commits) {
    const outcome = await mirrorOne(deps, mirrored(commit, manifest));

    if (outcome.failure !== null) {
      return { ...summary, failed: [`${commit.sha}: ${outcome.failure}`] };
    }
    await deps.cursor.write(commit.sha);
    summary = advanced(summary, commit.sha, outcome);
  }

  return summary;
}

type CommitResult = Pick<MirrorOutcome, "created" | "updated" | "unchanged"> & {
  failure: string | null;
};

/** A push that threw and a push with a failed item are the same: the commit did not land whole. */
async function mirrorOne(
  deps: CommitHistoryDeps,
  commit: MirroredCommit,
): Promise<CommitResult> {
  try {
    const outcome = await deps.mirror(commit);

    return { ...outcome, failure: mirrorFailure(outcome) };
  } catch (error) {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
      failure: errorMessage(error),
    };
  }
}

function advanced(
  summary: UtopiaCommitsSummary,
  sha: string,
  result: CommitResult,
): UtopiaCommitsSummary {
  return {
    ...summary,
    to: sha,
    commits: summary.commits + 1,
    created: summary.created + result.created,
    updated: summary.updated + result.updated,
    unchanged: summary.unchanged + result.unchanged,
  };
}

/** Each changed path classed as the ingest classes it: a spec or an ADR by the manifest's globs or the built-in prefixes, anything else code. */
function mirrored(
  commit: CommitDetail,
  manifest: string | null,
): MirroredCommit {
  const { files, ...words } = commit;

  return { ...words, files: classified(files, manifest) };
}

function classified(
  files: CommitDetail["files"],
  manifest: string | null,
): ChangedFile[] {
  const paths = files.map((file) => file.path);
  const docKinds = new Map(
    docsToMirror(paths, manifest).map((doc) => [doc.path, doc.kind]),
  );

  return paths.map((path) => ({ path, kind: docKinds.get(path) ?? "code" }));
}
