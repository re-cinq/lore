// Resuming a loop (specs/loop-pause FR2, FR4): forget its pause, and for a loop started once per item, run again the station whose credit ran out, since nothing else would start that item again.
import {
  creditFailedVisitOf,
  type ReportedVisit,
} from "@re-cinq/lore-shared/loops/credit-failure.js";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import type { LoopPause } from "@re-cinq/lore-shared/loops/loop-pause.js";

/** Loops that start a run once per item (a merged spec, a week) and would never start it again. The rest pick the item up again themselves: the implementation loop's tick takes the ticket, the triage sweep the issue; review approved without one, auto merge runs no model, and a digest run again would post a day already past beside the next one. */
const RERUN_ON_RESUME: readonly LoopKey[] = ["tickets", "upkeep"];

export interface ResumeLoopDeps {
  resume(): Promise<void>;
  visits(runId: string): Promise<ReportedVisit[]>;
  rerun(runId: string, nodeId: string): Promise<void>;
}

/** Runs the starved station again, then resumes the loop, and answers the run it started again, or null. The station runs first: a floor that refuses it leaves the pause in place, so the person can resume again. */
export async function resumeLoop(
  key: LoopKey,
  pause: LoopPause | null,
  deps: ResumeLoopDeps,
): Promise<string | null> {
  const rerun = await rerunStarvedStation(key, pause, deps);

  await deps.resume();

  return rerun;
}

async function rerunStarvedStation(
  key: LoopKey,
  pause: LoopPause | null,
  deps: ResumeLoopDeps,
): Promise<string | null> {
  const runId = pause?.run_id;

  if (!runId || !RERUN_ON_RESUME.includes(key)) {
    return null;
  }
  const failed = creditFailedVisitOf(await deps.visits(runId));

  if (!failed) {
    return null;
  }
  await deps.rerun(runId, failed.nodeId);

  return runId;
}
