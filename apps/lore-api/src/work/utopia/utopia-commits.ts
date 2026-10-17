// Mirrors a repo's default-branch commits into its Utopia knowledge base: the newest commits above the cursor its settings hold, pushed oldest-first through the mirror an ingest uses with the cursor moved past each, so a walk that stops leaves the next one where it was. A push to the branch runs a walk, so new commits arrive as they land.

import { errorMessage } from "@re-cinq/lore-shared";
import type {
  BranchHistoryOptions,
  CommitDetail,
} from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { MirroredCommit } from "@re-cinq/lore-shared/utopia/commit-statements.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/mirror-document.js";
import type { UtopiaCommitsSummary } from "@re-cinq/lore-shared/utopia/backfill-summary.js";
import { mirrorFailure } from "./utopia-mirror.js";

export interface CommitHistoryDeps {
  /** The walks of one repo run one after the other in this process: a second push during a walk waits for it, then finds what landed since. */
  repo: string;
  history: {
    branchHistory(
      branch: string,
      opts: BranchHistoryOptions,
    ): Promise<CommitDetail[]>;
  };
  cursor: {
    read(): Promise<string | null>;
    write(sha: string): Promise<void>;
  };
  mirror(commit: MirroredCommit): Promise<MirrorOutcome>;
}

/** A walk takes at most the newest 200 commits above the cursor: the first walk of a repo starts its history 200 commits back instead of at the root, and every later one, run by a push, finds a handful. */
export const MAX_COMMITS_PER_RUN = 200;

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

  return walk(deps, commits, nothingPushed(branch, from));
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
  start: UtopiaCommitsSummary,
): Promise<UtopiaCommitsSummary> {
  let summary = start;

  for (const commit of commits) {
    const outcome = await mirrorOne(deps, commit);

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
