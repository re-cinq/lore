// The auto-merge loop's wait (specs/protected-branch-merge): what a pull request is judged on before Lore approves and merges it. The wait fixes nothing and asks nothing of an agent; a pull request that is not ready is waited out until the loop that opened it has put it right.
import {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
  type Project,
} from "@re-cinq/lore-shared";
import { autoMergeMinAgeHours } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreReviewVerdict } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type {
  PullRef,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  decideMergeReady,
  type MergeReadyInput,
} from "./decide-merge-ready.js";
import type {
  LoopRunSlice,
  ParkedReport,
  PrReadyCheckDeps,
} from "./sweep-contract.js";

/** The reads only the auto-merge wait makes, beside the sweep's own. */
export interface MergeWaitReads {
  /** When the pull request was opened, and whether it conflicts with its base. */
  pullFacts(
    repo: string,
    number: number,
  ): Promise<{ createdAt: string | null; mergeable: boolean | null }>;
  minAgeHours(repo: string): Promise<number>;
  now(): number;
}

export type MergeWaitDeps = Pick<
  PrReadyCheckDeps,
  | "listPrCommits"
  | "listChecks"
  | "hasCiHistory"
  | "listReviewThreads"
  | "countOpenReviewRuns"
> &
  MergeWaitReads;

const HOUR_MS = 60 * 60 * 1000;

/** Success once the pull request is ready; null while anything still holds it. */
export async function mergeReportForRun(
  run: LoopRunSlice,
  deps: MergeWaitDeps,
): Promise<ParkedReport | null> {
  const prNumber = Number(run.args.pr_number) || 0;
  const headSha = ciJudgedSha(await deps.listPrCommits(run.repo, prNumber));

  if (!prNumber || !headSha) {
    return null;
  }
  const verdict = decideMergeReady(
    await mergeInput(run.repo, deps, { prNumber, headSha }),
  );

  return verdict.kind === "ready" ? { outcome: "success", args: {} } : null;
}

async function mergeInput(
  repo: string,
  deps: MergeWaitDeps,
  { prNumber, headSha }: { prNumber: number; headSha: string },
): Promise<MergeReadyInput> {
  const [checks, threads, openReviewRuns, hasCiHistory, facts, minAgeHours] =
    await Promise.all([
      deps.listChecks(repo, headSha),
      deps.listReviewThreads(repo, prNumber),
      deps.countOpenReviewRuns(repo, prNumber),
      deps.hasCiHistory(repo),
      deps.pullFacts(repo, prNumber),
      deps.minAgeHours(repo),
    ]);

  return {
    mergeable: facts.mergeable,
    ci: ciConclusionOf(externalCheckRuns(checks)),
    hasCiHistory,
    unresolvedThreads: openThreads(threads).length,
    openReviewRuns,
    review: loreReviewVerdict(checks),
    ageHours: ageHours(facts.createdAt, deps.now()),
    minAgeHours,
  };
}

function openThreads(threads: readonly ReviewThread[]): ReviewThread[] {
  return threads.filter((t) => !t.isResolved && !t.isOutdated);
}

/** A pull request whose opening time GitHub did not answer is treated as old enough: the age guards against merging too soon, not against a read that failed. */
function ageHours(createdAt: string | null, now: number): number {
  return createdAt ? (now - Date.parse(createdAt)) / HOUR_MS : Infinity;
}

type MergeProjectOf = (
  repo: string,
) => Promise<Pick<Project, "pulls" | "settings">>;

/** The reads only the auto-merge wait makes, through the sweep's per-repo cache. */
export function mergeReads(projectOf: MergeProjectOf): MergeWaitReads {
  return {
    pullFacts: async (repo, number) =>
      pullFactsOf(await (await projectOf(repo)).pulls.get(number)),
    minAgeHours: async (repo) =>
      autoMergeMinAgeHours(
        await (await projectOf(repo)).settings.rawSettings(),
      ),
    now: () => Date.now(),
  };
}

function pullFactsOf(pull: Pick<PullRef, "createdAt" | "mergeable"> | null): {
  createdAt: string | null;
  mergeable: boolean | null;
} {
  return {
    createdAt: pull?.createdAt ?? null,
    mergeable: pull?.mergeable ?? null,
  };
}
