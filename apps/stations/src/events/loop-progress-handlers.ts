// Refreshes the lore/implementation-loop GitHub check on pull request head movement and sweep ticks, complementing the live floor watch and the lore-run-settled service station (specs/implementation-loop FR17).
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  clearLoopProgressArgs,
  LOOP_STEP_DESCRIPTIONS,
  loopPrNumberOf,
  loopProgressCheck,
  loopProgressProductionDeps,
  publishLoopRunProgress,
  supersededLoopCheck,
  type LoopCheckContext,
  type LoopProgressDeps,
  type LoopRunView,
  type LoopVisitView,
} from "../outbound/loop-progress.js";

export {
  clearLoopProgressArgs,
  LOOP_STEP_DESCRIPTIONS,
  loopPrNumberOf,
  loopProgressCheck,
  loopProgressProductionDeps,
  publishLoopRunProgress,
  supersededLoopCheck,
  type LoopCheckContext,
  type LoopProgressDeps,
  type LoopRunView,
  type LoopVisitView,
};

export const LOOP_PROGRESS_EVENTS: readonly string[] = [
  "github.pull_request.opened",
  "github.pull_request.synchronize",
  "github.pull_request.ready_for_review",
  "github.pull_request.reopened",
  "cron.pr_ready_check.tick",
];

/** Builds event handlers for pull-request head movement and sweep ticks that refresh lore/implementation-loop. */
export function loopProgressHandlers(
  deps: LoopProgressDeps,
): Map<string, EventHandler> {
  const handle = handleProgressEvent(deps);

  return new Map(LOOP_PROGRESS_EVENTS.map((name) => [name, handle]));
}

function handleProgressEvent(deps: LoopProgressDeps): EventHandler {
  return async (params) => {
    const runId = typeof params.run_id === "string" ? params.run_id : undefined;

    if (runId) {
      await refreshLoopRunById(deps, runId);

      return;
    }
    const repo = typeof params.repo === "string" ? params.repo : undefined;
    const prNumber =
      typeof params.pr_number === "number" ? params.pr_number : undefined;

    await refreshOpenLoopRuns(deps, { repo, prNumber });
  };
}

/** Refreshes the check for one loop run by id. */
export async function refreshLoopRunById(
  deps: LoopProgressDeps,
  runId: string,
): Promise<void> {
  const run = await deps.run(runId);

  if (!run || run.lineId !== LOOP_LINE) {
    return;
  }
  const visits = await deps.visits(runId);

  await publishLoopRunProgress(deps, run, visits);
}

/** Refreshes the check for every open loop run, optionally scoped to one repo and pull request. */
export async function refreshOpenLoopRuns(
  deps: LoopProgressDeps,
  filter?: { repo?: string; prNumber?: number },
): Promise<void> {
  const runs = (await deps.openLoopRuns?.(filter?.repo)) ?? [];

  for (const run of runs) {
    await refreshFilteredRun(deps, run, filter?.prNumber);
  }
}

async function refreshFilteredRun(
  deps: LoopProgressDeps,
  run: LoopRunView,
  prNumber?: number,
): Promise<void> {
  const visits = await deps.visits(run.id);

  if (prNumber !== undefined && loopPrNumberOf(run, visits) !== prNumber) {
    return;
  }
  await publishLoopRunProgress(deps, run, visits);
}
