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

/** Locates the parked node and gathers everything `decidePrReady` needs, or null to skip this run untallied. */
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
  const prNumber = Number(run.args.pr_number) || 0;

  if (!prNumber) {
    console.log(
      `[pr-ready-check] run ${run.id} parked with no pr_number — skipped`,
    );

    return null;
  }
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

  return {
    target: {
      lineId: run.id,
      nodeId: parked.nodeId,
      iteration: parked.iteration,
    },
    verdict: decidePrReady({ ci, threads, openReviewRunCount, hasCiHistory }),
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
export async function prReadyCheckJob(): Promise<string> {
  const { pipeline, eventProxy } = await import("../../kernel/queues.js");
  const { queuedReporter } =
    await import("@re-cinq/lore-shared/project/events/event-proxy.js");
  const { projectFor } = await import("../../kernel/project-boot.js");
  const { reportToParkedNode } =
    await import("@re-cinq/lore-shared/project/assembly-runs/parked-node.js");
  const OPEN = ["queued", "running"] as const;
  // One Project per repo per sweep; avoid rebuilding the same repo facade three times for three PR reads
  const projects = new Map<string, ReturnType<typeof projectFor>>();
  const projectOf = (repo: string) => {
    const cached = projects.get(repo) ?? projectFor(repo);

    projects.set(repo, cached);

    return cached;
  };
  const ciHistory = new Map<string, Promise<boolean>>();
  const readCiHistory = async (repo: string): Promise<boolean> => {
    const project = await projectOf(repo);

    return (
      (await project.pulls.ciConclusion(await project.repo.defaultBranch())) !==
      "none"
    );
  };

  return prReadyCheckSweep({
    listOpenLoopRuns: () =>
      pipeline().assemblyRuns.list({
        blueprintName: "implementation-loop",
        status: OPEN,
      }),
    listStationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    getPrHeadSha: async (repo, number) =>
      (await (await projectOf(repo)).pulls.get(number))?.headSha ?? null,
    ciConclusion: async (repo, ref) =>
      (await projectOf(repo)).pulls.ciConclusion(ref),
    // Memoised per repo: this is a REPO fact; asking once per PR saves GitHub reads
    hasCiHistory: (repo) => {
      const cached = ciHistory.get(repo) ?? readCiHistory(repo);

      ciHistory.set(repo, cached);

      return cached;
    },
    listReviewThreads: async (repo, number) =>
      (await projectOf(repo)).pulls.listReviewThreads(number),
    countOpenReviewRuns: async (repo, number) =>
      (
        await pipeline().assemblyRuns.listSummaries({
          repo,
          blueprintName: REVIEW_DEFINITIONS,
          status: OPEN,
          prNumber: number,
        })
      ).length,
    // Report through queue, not direct insert; sweep resolves regardless of delivery to avoid losing resume on router blip
    report: (target, outcome, args) =>
      reportToParkedNode(queuedReporter(eventProxy()), target, {
        outcome,
        args,
      }),
  });
}
