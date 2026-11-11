// The stations the external floor dispatches for the implementation-loop line, plus the floor watch that publishes lore/implementation-loop on each step transition (specs/implementation-loop FR17).
import type { RunningStation } from "@re-cinq/floor-station";
import { LOOP_LINE } from "@re-cinq/lore-shared/backlog/floor-loop.js";
import type { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  loopProgressProductionDeps,
  publishLoopRunProgress,
  type LoopProgressDeps,
} from "../outbound/loop-progress.js";
import { startBriefStation } from "./brief/station.js";
import { startDoneCheckStation } from "./done-check/station.js";
import { startMarkReadyStation } from "./mark-ready/station.js";
import { startOpenLoopPrStation } from "./open-pr/station.js";
import { startReadyForReviewStation } from "./ready-for-review/station.js";
import { startSyncCheckStation } from "./sync-check/station.js";

type Floor = ReturnType<typeof floorClient>;
export type LoopWatchFrame =
  Awaited<ReturnType<Floor["runs"]["watchFloor"]>> extends AsyncIterable<
    infer F
  >
    ? F
    : never;

export interface LoopProgressWatchDeps extends LoopProgressDeps {
  watchFloor(): AsyncIterable<LoopWatchFrame> & { stop(): void };
}

export function startImplementationLoopStations(): RunningStation[] {
  return [
    startOpenLoopPrStation(),
    startMarkReadyStation(),
    startSyncCheckStation(),
    startReadyForReviewStation(),
    startDoneCheckStation(),
    startBriefStation(),
    startLoopProgressStation(),
  ];
}

/** Follows the floor's live stream when a floor is configured, refreshing lore/implementation-loop as runs enter each step and finish. */
export function startLoopProgressStation(): RunningStation {
  const floor = floorIfConfigured();

  if (!floor) {
    return { once: () => Promise.resolve(0), stop: () => Promise.resolve() };
  }

  return startLoopProgressWatch({
    ...loopProgressProductionDeps,
    watchFloor: () => floor.runs.watchFloor(),
  });
}

/** Starts a live floor watch that refreshes the progress check on run_started, run_changed, and resync frames. */
export function startLoopProgressWatch(
  deps: LoopProgressWatchDeps,
): RunningStation {
  const watch = deps.watchFloor();

  void consumeWatch(deps, watch);

  return {
    once: () => Promise.resolve(0),
    stop: () => {
      watch.stop();

      return Promise.resolve();
    },
  };
}

async function consumeWatch(
  deps: LoopProgressWatchDeps,
  watch: AsyncIterable<LoopWatchFrame>,
): Promise<void> {
  try {
    for await (const frame of watch) {
      await handleWatchFrame(deps, frame);
    }
  } catch (err) {
    console.warn(`[loop-progress] watch ended: ${(err as Error).message}`);
  }
}

async function handleWatchFrame(
  deps: LoopProgressWatchDeps,
  frame: LoopWatchFrame,
): Promise<void> {
  if (frame.type === "resync") {
    await resyncLoopRuns(deps);

    return;
  }
  const run = await deps.run(frame.runId);

  if (run?.lineId === LOOP_LINE) {
    await publishLoopRunProgress(deps, run, await deps.visits(run.id));
  }
}

async function resyncLoopRuns(deps: LoopProgressWatchDeps): Promise<void> {
  const runs = (await deps.openLoopRuns?.()) ?? [];

  for (const run of runs) {
    await publishLoopRunProgress(deps, run, await deps.visits(run.id));
  }
}
