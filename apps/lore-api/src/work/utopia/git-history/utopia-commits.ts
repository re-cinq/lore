// Mirrors a repo's default-branch commits into its Utopia knowledge base: the newest commits above the cursor its settings hold, pushed oldest-first as text documents to the repo's `git-history` source with the cursor moved past each, so a walk that stops leaves the next one where it was. A push to the branch runs a walk, so new commits arrive as they land.

import type {
  BranchHistoryOptions,
  CommitDetail,
} from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { MirroredCommit } from "@re-cinq/lore-shared/utopia/commit-text.js";
import type { MirrorOutcome } from "@re-cinq/lore-shared/utopia/push-items.js";
import type { UtopiaCommitsSummary } from "@re-cinq/lore-shared/utopia/commits-summary.js";
import { mirrorCommit } from "@re-cinq/lore-shared/utopia/mirror-commits.js";
import { saveUtopiaCommitsHead } from "../../../outbound/utopia-sources.js";
import { queuedPerRepo, walkInOrder } from "../cursor-walk.js";
import { lazyKindDocumentDeps } from "../kind-source.js";
import { storedCursor, type WalkSource } from "../walk-source.js";

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

async function walkBranch(
  deps: CommitHistoryDeps,
  branch: string,
): Promise<UtopiaCommitsSummary> {
  const from = await deps.cursor.read();
  const commits = await deps.history.branchHistory(branch, {
    ...(from === null ? {} : { until: from }),
    limit: MAX_COMMITS_PER_RUN,
  });
  const { landed, ...tally } = await walkInOrder(commits, {
    cursorOf: (commit) => commit.sha,
    labelOf: (commit) => commit.sha,
    mirror: (commit) => deps.mirror(commit),
    writeCursor: (sha) => deps.cursor.write(sha),
  });

  return { branch, from, ...tally, commits: landed };
}

export function commitHistoryDepsFor(
  source: WalkSource<CommitHistoryDeps["history"]>,
): CommitHistoryDeps {
  const { pool, repo } = source;
  const history = lazyKindDocumentDeps(pool, repo, "git-history");

  return {
    repo,
    history: source.files,
    cursor: {
      read: () => storedCursor(source, "commits_head"),
      write: (sha) => saveUtopiaCommitsHead(pool, repo, sha),
    },
    mirror: (commit) => mirrorCommit(history, repo, commit),
  };
}
