// Starts the auto-merge loop (specs/protected-branch-merge): one run per open pull request code review has passed, in every repository whose loop is on.
import { mergeCandidate } from "@re-cinq/lore-shared/loops/merge-candidate.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** Starts per repository per tick: a burst of reviewed pull requests reaches the floor over a few ticks rather than all at once. */
export const STARTS_PER_REPO = 3;

export interface AutoMergeTickDeps {
  /** The onboarded repositories whose auto-merge loop is on. */
  repos(): Promise<string[]>;
  openPulls(repo: string): Promise<PullRef[]>;
  /** Lore's review stands approved on the pull request's head. */
  reviewPassed(repo: string, pull: PullRef): Promise<boolean>;
  /** The pull request URLs an auto-merge run is open for, and the `headKey` of every head commit a run was started on, settled or not. */
  workedPulls(repo: string): Promise<ReadonlySet<string>>;
  start(repo: string, pull: PullRef): Promise<void>;
}

export async function autoMergeTick(deps: AutoMergeTickDeps): Promise<string> {
  const repos = await deps.repos();
  const started = await Promise.all(
    repos.map((repo) => startForRepo(deps, repo)),
  );
  const total = started.reduce((sum, count) => sum + count, 0);

  return `auto-merge-tick: ${repos.length} repo(s), started ${total} run(s)`;
}

async function startForRepo(
  deps: AutoMergeTickDeps,
  repo: string,
): Promise<number> {
  const [pulls, worked] = await Promise.all([
    deps.openPulls(repo),
    deps.workedPulls(repo),
  ]);
  const candidates = pulls.filter(
    (pull) => mergeCandidate(pull, repo) && !alreadyWorked(pull, worked),
  );
  const passed = await reviewed(deps, repo, candidates);
  const due = passed.slice(0, STARTS_PER_REPO);

  for (const pull of due) {
    await deps.start(repo, pull);
  }

  return due.length;
}

/** A run is working the pull request, or one already settled on this head: an armed or parked pull request is taken again only once someone pushes to it. */
function alreadyWorked(pull: PullRef, worked: ReadonlySet<string>): boolean {
  return worked.has(pull.url) || worked.has(headKey(pull.url, pull.headSha));
}

export function headKey(url: string, headSha: string | undefined): string {
  return `${url}@${headSha ?? ""}`;
}

async function reviewed(
  deps: AutoMergeTickDeps,
  repo: string,
  pulls: readonly PullRef[],
): Promise<PullRef[]> {
  const passed = await Promise.all(
    pulls.map((pull) => deps.reviewPassed(repo, pull)),
  );

  return pulls.filter((_, i) => passed[i]);
}
