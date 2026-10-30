// Resuming a loop (specs/loop-pause FR2, FR4): forget its pause, and for a loop started once per item, run again the station whose credit ran out, since nothing else would start that item again.
import {
  creditFailedVisitOf,
  type ReportedVisit,
} from "@re-cinq/lore-shared/loops/credit-failure.js";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import type { LoopPause } from "@re-cinq/lore-shared/loops/loop-pause.js";

/** Loops that start a run once per item (a merged spec, a week, a day). The rest pick the item up again themselves: the implementation loop's tick takes the ticket, the triage sweep the issue; review approved without one and auto merge runs no model. */
const RERUN_ON_RESUME: readonly LoopKey[] = ["tickets", "upkeep", "digest"];

export interface ResumeLoopDeps {
  resume(): Promise<void>;
  visits(runId: string): Promise<ReportedVisit[]>;
  rerun(runId: string, nodeId: string): Promise<void>;
}

/** Resumes the loop, and answers the run it started again, or null. */
export async function resumeLoop(
  key: LoopKey,
  pause: LoopPause | null,
  deps: ResumeLoopDeps,
): Promise<string | null> {
  await deps.resume();
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
