import type { PipelineRepositories } from "@re-cinq/lore-shared";
import type { Project } from "@re-cinq/lore-shared";
import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import {
  parkedHumanNode,
  type ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { ciReportForRun, prReportForRun } from "./park-readers.js";
import type {
  LoopRunSlice,
  ParkedReport,
  PrReadyCheckDeps,
} from "./sweep-contract.js";

export type {
  LoopRunSlice,
  ParkedReport,
  PrReadyCheckDeps,
} from "./sweep-contract.js";

/** Parks located by station TYPE from run's graph; id is pre-clone fallback. A run holds at most one open row, so the two are never ambiguous. */
const AWAIT_STATION_TYPE = "pr_review";
const AWAIT_NODE = "await-pr";
const CI_STATION_TYPE = "ci_check";
const CI_NODE = "await-ci";

/** One parked run, ready to verdict: the target to report to plus what to report. */
interface ParkedVerdict {
  target: ParkedTarget;
  /** null while the park has nothing to act on — a tick that is waiting, not one that is skipped. */
  report: ParkedReport | null;
}

// Which node of which run the verdict is reported against. The iteration is part of it: a run that has been round the loop before has several attempts at the same node, and the report has to name the one that is parked.
function targetOf(
  run: LoopRunSlice,
  parked: { nodeId: string; iteration: number },
) {
  return {
    lineId: run.id,
    nodeId: parked.nodeId,
    iteration: parked.iteration,
  };
}

/** The two parks, each with the reader that judges it. Ordered CI-first only for determinism: a run holds one open row, so at most one ever matches. */
const PARK_KINDS = [
  { type: CI_STATION_TYPE, fallbackNodeId: CI_NODE, read: ciReportForRun },
  {
    type: AWAIT_STATION_TYPE,
    fallbackNodeId: AWAIT_NODE,
    read: prReportForRun,
  },
] as const;

/** The park this run is sitting at, with the reader that judges it. */
async function parkedAt(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<{
  parked: { nodeId: string; iteration: number };
  read: (typeof PARK_KINDS)[number]["read"];
} | null> {
  const rows = await deps.listStationRuns(run.id);

  for (const kind of PARK_KINDS) {
    const parked = parkedHumanNode(run.status, rows, run.graph, kind);

    if (parked) {
      return { parked, read: kind.read };
    }
  }

  return null;
}

/** Locates the parked node and pairs it with its report, or null to skip this run untallied. */
async function evaluateParkedRun(
  run: LoopRunSlice,
  deps: PrReadyCheckDeps,
): Promise<ParkedVerdict | null> {
  const at = await parkedAt(run, deps);

  if (!at) {
    return null;
  }

  return {
    target: targetOf(run, at.parked),
    report: await at.read(run, deps),
  };
}

/** Sweep tallies, mutated in place as each run resolves. */
interface SweepTally {
  resumed: number;
  blocked: number;
  waiting: number;
  errors: number;
}

// Reports the verdict and counts it. Only ready and blocked are reported — waiting is the absence of news, and telling the parked node about it every tick would wake a run that has nothing to act on.
async function applyVerdict(
  evaluated: ParkedVerdict,
  deps: PrReadyCheckDeps,
  tally: SweepTally,
): Promise<void> {
  const { target, report } = evaluated;

  if (!report) {
    tally.waiting++;

    return;
  }
  await deps.report(target, report.outcome, report.args);

  if (report.outcome === "success") {
    tally.resumed++;

    return;
  }
  tally.blocked++;
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
  await applyVerdict(evaluated, deps, tally);
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

  return { projectOf, hasCiHistory: perRepo(ciHistoryProbe(projectOf)) };
}

/** The PR-side reads, all through one per-sweep repo cache. */
function prReads(
  projectOf: (repo: string) => Promise<Pick<Project, "pulls">>,
): Pick<
  PrReadyCheckDeps,
  "listPrCommits" | "listChecks" | "listReviewThreads"
> {
  return {
    listPrCommits: async (repo, number) =>
      (await projectOf(repo)).pulls.listCommits(number),
    listChecks: async (repo, ref) =>
      (await projectOf(repo)).pulls.listChecks(ref),
    listReviewThreads: async (repo, number) =>
      (await projectOf(repo)).pulls.listReviewThreads(number),
  };
}

const OPEN_RUN_STATUS = ["queued", "running"] as const;

/** How many reviews of this PR are still running. This is what keeps a PR parked while a review of it is in flight — resuming then would judge CI that the review is about to invalidate. */
function openReviewRunCounter(
  pipeline: () => Pick<PipelineRepositories, "assemblyRuns">,
) {
  return async (repo: string, number: number) =>
    (
      await pipeline().assemblyRuns.listSummaries({
        repo,
        blueprintName: REVIEW_DEFINITIONS,
        status: OPEN_RUN_STATUS,
        prNumber: number,
      })
    ).length;
}

/** The run-side reads. */
function runReads(
  pipeline: () => Pick<PipelineRepositories, "assemblyRuns">,
): Pick<
  PrReadyCheckDeps,
  "listOpenLoopRuns" | "listStationRuns" | "countOpenReviewRuns"
> {
  return {
    listOpenLoopRuns: () =>
      pipeline().assemblyRuns.list({
        blueprintName: "implementation-loop",
        status: OPEN_RUN_STATUS,
      }),
    listStationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    countOpenReviewRuns: openReviewRunCounter(pipeline),
  };
}

/** Production entry — the manifest's run. Deps bound to the stations kernel. */
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
