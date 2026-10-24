// The pull request reads the Loops tab's routes share, held per repository for 20 seconds: code review, auto merge and spec upkeep each listed the open pull requests, two listed the week's merges, and auto merge read every head's checks, about a hundred GitHub calls on one board load, and again on every live refresh.
import type { Project } from "@re-cinq/lore-shared";
import type {
  CheckRun,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { memoizeByKeyWithTtl } from "../../../work/chunks/ttl-memo.js";

export type LoopPulls = Pick<
  Project["pulls"],
  "list" | "listMergedSince" | "listChecks"
>;

export interface LoopPullReads {
  openPulls(repo: string, pulls: LoopPulls): Promise<PullRef[]>;
  /** The pull requests merged in the last seven days. */
  mergedThisWeek(repo: string, pulls: LoopPulls): Promise<PullRef[]>;
  checksOf(repo: string, sha: string, pulls: LoopPulls): Promise<CheckRun[]>;
}

/** How long a read is shared: under the live refreshes' pace, over one board load. */
const FRESH_MS = 20_000;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** One set of shared reads, for one server: each read keyed by repository, and by head commit for checks. */
export function loopPullReads(now: () => number = Date.now): LoopPullReads {
  const open = sharedRead((pulls) => pulls.list(), now);
  const merged = sharedRead(
    (pulls) => pulls.listMergedSince(new Date(now() - WEEK_MS).toISOString()),
    now,
  );
  const checks = sharedRead(
    (pulls, key) => pulls.listChecks(key.slice(key.lastIndexOf("@") + 1)),
    now,
  );

  return {
    openPulls: (repo, pulls) => open(repo, pulls),
    mergedThisWeek: (repo, pulls) => merged(repo, pulls),
    checksOf: (repo, sha, pulls) => checks(`${repo}@${sha}`, pulls),
  };
}

/** A read shared by key for 20 seconds, made through the facade of the caller that missed: the memo calls it at once on a miss, so that caller's facade is the one in hand. */
function sharedRead<T>(
  read: (pulls: LoopPulls, key: string) => Promise<T>,
  now: () => number,
): (key: string, pulls: LoopPulls) => Promise<T> {
  let caller: LoopPulls | undefined;
  const memo = memoizeByKeyWithTtl(
    (key) => read(caller as LoopPulls, key),
    FRESH_MS,
    now,
  );

  return (key, pulls) => {
    caller = pulls;

    return memo(key);
  };
}
