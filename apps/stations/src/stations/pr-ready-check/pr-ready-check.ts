import type { CiConclusion } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { ReviewThread } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { REVIEW_DEFINITIONS } from "@re-cinq/lore-shared/review/review-definitions.js";
import {
  parkedHumanNode,
  type ParkedNode,
  type ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { decidePrReady } from "./decide-ready.js";

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
  listReviewThreads(repo: string, number: number): Promise<ReviewThread[]>;
  /** Open runs of the PR-review family for this PR — "the address round-trip
   *  is still in flight" signal. */
  countOpenReviewRuns(repo: string, number: number): Promise<number>;
  report(
    target: ParkedTarget,
    outcome: "success" | "changes_requested",
    args?: Record<string, unknown>,
  ): Promise<void>;
}

/** The park is located by station TYPE from the run's own graph;
 *  the id is only the pre-clone fallback. */
const AWAIT_STATION_TYPE = "pr_review";
const AWAIT_NODE = "await-pr";

/**
 * Evaluate every open implementation-loop run parked at await-pr and resume
 * the ones whose PR has settled (specs/implementation-loop FR4): green CI with
 * zero unresolved-and-current threads resumes `success`; red CI, or unresolved
 * threads with no review-family run open, resumes `changes_requested`. A
 * pending CI or an in-flight address round-trip is left for the next tick.
 * One bad PR read never stops the sweep.
 */
export async function prReadyCheckSweep(
  deps: PrReadyCheckDeps,
): Promise<string> {
  const runs = await deps.listOpenLoopRuns();
  let resumed = 0;
  let blocked = 0;
  let waiting = 0;
  let errors = 0;

  for (const run of runs) {
    try {
      const parked = parkedHumanNode(
        run.status,
        await deps.listStationRuns(run.id),
        run.graph,
        AWAIT_STATION_TYPE,
        AWAIT_NODE,
      );

      if (!parked) {
        continue;
      }
      const prNumber = Number(run.args.pr_number) || 0;

      if (!prNumber) {
        console.log(
          `[pr-ready-check] run ${run.id} parked with no pr_number — skipped`,
        );
        continue;
      }
      const headSha = await deps.getPrHeadSha(run.repo, prNumber);

      if (!headSha) {
        console.log(
          `[pr-ready-check] PR #${prNumber} on ${run.repo} has no head sha — skipped`,
        );
        continue;
      }
      const verdict = decidePrReady({
        ci: await deps.ciConclusion(run.repo, headSha),
        threads: await deps.listReviewThreads(run.repo, prNumber),
        openReviewRunCount: await deps.countOpenReviewRuns(run.repo, prNumber),
      });
      const target: ParkedTarget = {
        lineId: run.id,
        nodeId: parked.nodeId,
        iteration: parked.iteration,
      };

      if (verdict.kind === "ready") {
        await deps.report(target, "success");
        resumed++;
      } else if (verdict.kind === "blocked") {
        await deps.report(target, "changes_requested", {
          reason: verdict.reason,
        });
        blocked++;
      } else {
        waiting++;
      }
    } catch (err) {
      errors++;
      console.error(
        `[pr-ready-check] run ${run.id}: ${(err as Error).message}`,
      );
    }
  }

  const base = `checked ${runs.length}, resumed ${resumed}, blocked ${blocked}, waiting ${waiting}`;

  return errors > 0 ? `${base}, errors ${errors}` : base;
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
  // One Project per repo per sweep — three PR reads per run would otherwise
  // rebuild the same repo facade three times.
  const projects = new Map<string, ReturnType<typeof projectFor>>();
  const projectOf = (repo: string) => {
    const cached = projects.get(repo) ?? projectFor(repo);

    projects.set(repo, cached);

    return cached;
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
    // Through the proxy's QUEUE, not a direct insert: the sweep catches per run
    // and then resolves, so its delivery is marked done whether or not the
    // report landed — a router blip used to lose the resume outright and the
    // parked node waited for the reaper.
    report: (target, outcome, args) =>
      reportToParkedNode(queuedReporter(eventProxy()), target, outcome, args),
  });
}
