// The sweep's reads of the repository and its pull requests, through one per-sweep repo cache: a sweep reads many PRs of the same repo, so the facade is built once and CI history is asked once rather than per PR.
import type { Project } from "@re-cinq/lore-shared";
import type { PrReadyCheckDeps } from "./sweep-contract.js";

/** Both caches hold REPO facts across one sweep: a sweep reads many PRs of the same repo, so the facade is built once and CI history is asked once rather than per PR. */
export function sweepRepoCache<
  P extends {
    pulls: { ciConclusion(ref: string): Promise<string> };
    repo: { defaultBranch(): Promise<string> };
  },
>(
  projectFor: (repo: string) => Promise<P>,
): {
  projectOf: (repo: string) => Promise<P>;
  hasCiHistory: (repo: string) => Promise<boolean>;
} {
  const projectOf = perRepo(projectFor);

  return { projectOf, hasCiHistory: perRepo(ciHistoryProbe(projectOf)) };
}

/** Memoizes a per-repo read for the length of one sweep. The PROMISE is cached, not its value, so two PRs of the same repo asked concurrently still make one call. */
function perRepo<T>(
  read: (repo: string) => Promise<T>,
): (repo: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();

  return (repo: string) => {
    const cached = cache.get(repo) ?? read(repo);

    cache.set(repo, cached);

    return cached;
  };
}

// "This repo runs CI at all" — decided off the DEFAULT BRANCH, so a PR that has simply not started its checks yet is not mistaken for a repo that has no CI to wait for.
function ciHistoryProbe<
  P extends {
    pulls: { ciConclusion(ref: string): Promise<string> };
    repo: { defaultBranch(): Promise<string> };
  },
>(projectOf: (repo: string) => Promise<P>) {
  return async (repo: string) => {
    const project = await projectOf(repo);

    return (
      (await project.pulls.ciConclusion(await project.repo.defaultBranch())) !==
      "none"
    );
  };
}

/** The sweep's reads that go to the pull request itself. */
type PrReads = Pick<
  PrReadyCheckDeps,
  | "listPrCommits"
  | "listChecks"
  | "failedJob"
  | "listReviewThreads"
  | "prMergeable"
  | "prBehindBy"
>;

/** The PR-side reads, all through one per-sweep repo cache. */
export function prReads(
  projectOf: (repo: string) => Promise<Pick<Project, "pulls" | "repo">>,
): PrReads {
  return {
    listPrCommits: async (repo, number) =>
      (await projectOf(repo)).pulls.listCommits(number),
    listChecks: async (repo, ref) =>
      (await projectOf(repo)).pulls.listChecks(ref),
    failedJob: async (repo, jobId) =>
      (await projectOf(repo)).pulls.failedJob(jobId),
    prMergeable: async (repo, number) =>
      (await (await projectOf(repo)).pulls.get(number))?.mergeable ?? null,
    prBehindBy: async (repo, number) =>
      behindMain(await projectOf(repo), number),
    listReviewThreads: async (repo, number) =>
      (await projectOf(repo)).pulls.listReviewThreads(number),
  };
}

/** How far the pull request's branch is behind the default branch: what `loop-sync-check` reads too, so the wait and the sync agree. */
async function behindMain(
  project: Pick<Project, "pulls" | "repo">,
  number: number,
): Promise<number | undefined> {
  const branch = (await project.pulls.get(number))?.branch;

  return branch ? project.repo.branchBehindBy(branch) : undefined;
}
