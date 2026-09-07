import type { PipelineRepositories } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import type { CiConclusion } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import {
  parkedHumanNode,
  type ParkedNode,
  type ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { decidePrReady, type PrReadyVerdict } from "./decide-ready.js";

/** The slice of one open implementation-loop run the sweep reads. */
export interface LoopRunSlice {
  id: string;
  repo: string;
  status: string;
  args: Record<string, unknown>;
  graph: RunGraph | null;
}

export interface PrReadyCheckDeps {
  listOpenLoopRuns(): Promise<LoopRunSlice[]>;
  listStationRuns(runId: string): Promise<ParkedNode[]>;
  /** The PR's head sha — the ref ciConclusion is asked about. */
  getPrHeadSha(repo: string, number: number): Promise<string | null>;
  ciConclusion(repo: string, ref: string): Promise<CiConclusion>;
  /** Does this repo run checks at all? A repo fact, not a clock. */
  hasCiHistory(repo: string): Promise<boolean>;
  listReviewThreads(repo: string, number: number): Promise<ReviewThread[]>;
  /** Open runs of PR-review family for this PR — "address round-trip in flight" signal. */
  countOpenReviewRuns(repo: string, number: number): Promise<number>;
  report(
    target: ParkedTarget,
    outcome: "success" | "changes_requested" | "failed",
    args?: Record<string, unknown>,
  ): Promise<void>;
}

/** Park located by station TYPE from run's graph; id is pre-clone fallback. */
const AWAIT_STATION_TYPE = "pr_review";
const AWAIT_NODE = "await-pr";

/** One parked run, ready to verdict: the target to report to plus what to report. */
interface ParkedVerdict {
  target: ParkedTarget;
  verdict: PrReadyVerdict;
}

/** The evidence a parked PR is judged on, or null when there is nothing to judge yet. All four reads run together — they are independent, and this job sweeps every parked run on a tick. */
async function verdictForRun(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<PrReadyVerdict | null> {
  const prNumber = Number(run.args.pr_number) || 0;

  if (!prNumber) {
    console.log(
      `[pr-ready-check] run ${run.id} parked with no pr_number — skipped`,
    );

    return null;
  }
  // A PR with no head sha has no commit to check — it was closed, or the branch is gone.
  const headSha = await deps.getPrHeadSha(run.repo, prNumber);

  if (!headSha) {
    console.log(
      `[pr-ready-check] PR #${prNumber} on ${run.repo} has no head sha — skipped`,
    );

    return null;
  }
  const [ci, threads, openReviewRunCount, hasCiHistory] = await Promise.all([
    deps.ciConclusion(run.repo, headSha),
    deps.listReviewThreads(run.repo, prNumber),
    deps.countOpenReviewRuns(run.repo, prNumber),
    deps.hasCiHistory(run.repo),
  ]);

  return decidePrReady({ ci, threads, openReviewRunCount, hasCiHistory });
}

/** Locates the parked node and pairs it with its verdict, or null to skip this run untallied. */
async function evaluateParkedRun(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<ParkedVerdict | null> {
  const parked = parkedHumanNode(
    run.status,
    await deps.listStationRuns(run.id),
    run.graph,
    { type: AWAIT_STATION_TYPE, fallbackNodeId: AWAIT_NODE },
  );

  if (!parked) {
    return null;
  }
  const verdict = await verdictForRun(run, deps);

  if (!verdict) {
    return null;
  }

  return {
    target: {
      lineId: run.id,
      nodeId: parked.nodeId,
      iteration: parked.iteration,
    },
    verdict,
  };
}

/** Sweep tallies, mutated in place as each run resolves. */
interface SweepTally {
  resumed: number;
  blocked: number;
  waiting: number;
  errors: number;
}

/** Reports one run's verdict (if it has one) and bumps the matching tally. */
async function reportParkedVerdict(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
  tally: SweepTally,
): Promise<void> {
  const evaluated = await evaluateParkedRun(run, deps);

  if (!evaluated) {
    return;
  }
  const { target, verdict } = evaluated;

  if (verdict.kind === "ready") {
    await deps.report(target, "success");
    tally.resumed++;

    return;
  }

  if (verdict.kind === "blocked") {
    await deps.report(target, verdict.outcome, { reason: verdict.reason });
    tally.blocked++;

    return;
  }
  tally.waiting++;
}

/** The sweep's one-line summary, with the error count appended only when there was one. */
function summarizeSweep(totalRuns: number, tally: SweepTally): string {
  const base = `checked ${totalRuns}, resumed ${tally.resumed}, blocked ${tally.blocked}, waiting ${tally.waiting}`;

  return tally.errors > 0 ? `${base}, errors ${tally.errors}` : base;
}

/** Resume implementation-loop await-pr nodes whose PR has settled: green CI or unresolved threads with no review run open (specs/implementation-loop FR4). */
export async function prReadyCheckSweep(
  deps: PrReadyCheckDeps,
): Promise<string> {
  const runs = await deps.listOpenLoopRuns();
  const tally: SweepTally = { resumed: 0, blocked: 0, waiting: 0, errors: 0 };

  for (const run of runs) {
    try {
      await reportParkedVerdict(run, deps, tally);
    } catch (err) {
      tally.errors++;
      console.error(
        `[pr-ready-check] run ${run.id}: ${(err as Error).message}`,
      );
    }
  }

  return summarizeSweep(runs.length, tally);
}

/** Production entry — the manifest's run. Deps bound to the stations kernel. */
/** Both caches hold REPO facts across one sweep: a sweep reads many PRs of the same repo, so the facade is built once and CI history is asked once rather than per PR. */
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

/** Both caches hold REPO facts across one sweep: a sweep reads many PRs of the same repo, so the facade is built once and CI history is asked once rather than per PR. */
function sweepRepoCache<
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

  return {
    projectOf,
    // "This repo runs CI at all" — decided off the default branch, so a PR that has simply not started its checks yet is not mistaken for a repo without any.
    hasCiHistory: perRepo(async (repo: string) => {
      const project = await projectOf(repo);

      return (
        (await project.pulls.ciConclusion(
          await project.repo.defaultBranch(),
        )) !== "none"
      );
    }),
  };
}

/** The PR-side reads, all through one per-sweep repo cache. */
function prReads(
  projectOf: (repo: string) => Promise<Pick<Project, "pulls">>,
): Pick<
  PrReadyCheckDeps,
  "getPrHeadSha" | "ciConclusion" | "listReviewThreads"
> {
  return {
    getPrHeadSha: async (repo, number) =>
      (await (await projectOf(repo)).pulls.get(number))?.headSha ?? null,
    ciConclusion: async (repo, ref) =>
      (await projectOf(repo)).pulls.ciConclusion(ref),
    listReviewThreads: async (repo, number) =>
      (await projectOf(repo)).pulls.listReviewThreads(number),
  };
}

/** The run-side reads. `countOpenReviewRuns` is what keeps a PR parked while a review of it is still in flight — resuming then would judge CI that the review is about to invalidate. */
function runReads(
  pipeline: () => Pick<PipelineRepositories, "assemblyRuns">,
): Pick<
  PrReadyCheckDeps,
  "listOpenLoopRuns" | "listStationRuns" | "countOpenReviewRuns"
> {
  const OPEN = ["queued", "running"] as const;

  return {
    listOpenLoopRuns: () =>
      pipeline().assemblyRuns.list({
        blueprintName: "implementation-loop",
        status: OPEN,
      }),
    listStationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    countOpenReviewRuns: async (repo, number) =>
      (
        await pipeline().assemblyRuns.listSummaries({
          repo,
          blueprintName: REVIEW_DEFINITIONS,
          status: OPEN,
          prNumber: number,
        })
      ).length,
  };
}

export async function prReadyCheckJob(): Promise<string> {
  const { pipeline, eventProxy } = await import("../../outbound/queues.js");
  const { queuedReporter } =
    await import("@re-cinq/lore-shared/project/events/event-proxy.js");
  const { projectFor } = await import("../../outbound/project-boot.js");
  const { reportToParkedNode } =
    await import("@re-cinq/lore-shared/project/assembly-runs/parked-node.js");
  const { projectOf, hasCiHistory } = sweepRepoCache(projectFor);

  return prReadyCheckSweep({
    ...runReads(pipeline),
    ...prReads(projectOf),
    hasCiHistory,
    // Reported through the queue rather than inserted directly, and the sweep resolves whether or not delivery lands — a router blip must not cost the run its resume.
    report: (target, outcome, args) =>
      reportToParkedNode(queuedReporter(eventProxy()), target, {
        outcome,
        args,
      }),
  });
}
