// A run that ran out of model credit pauses the loop it belongs to (specs/loop-pause FR3): the next tick would only fail its next item the same way.
import type { Handle } from "@re-cinq/floor-station";
import type { RunView, VisitView } from "@re-cinq/floor-client";
import { loreRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import { creditFailureOf } from "@re-cinq/lore-shared/loops/credit-failure.js";
import type { LoopKey } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { loopOfLine } from "@re-cinq/lore-shared/loops/loop-of-line.js";
import type { LoopPause } from "@re-cinq/lore-shared/loops/loop-pause.js";

export const CREDIT_PAUSE_REASON = "model credit exhausted";

export interface CreditPauseDeps {
  run(runId: string): Promise<RunView | null>;
  visits(runId: string): Promise<VisitView[]>;
  pauseLoop(repo: string, key: LoopKey, pause: LoopPause): Promise<void>;
  now(): Date;
}

export function pausingLoopsOnCredit(
  deps: CreditPauseDeps,
  next: Handle,
): Handle {
  return async (brief, tools) => {
    const key = loopOfLine(brief.needs.line_id);

    if (key && brief.needs.outcome !== "success") {
      await pauseOnCredit(deps, key, brief.needs.run_id);
    }

    return next(brief, tools);
  };
}

async function pauseOnCredit(
  deps: CreditPauseDeps,
  key: LoopKey,
  runId: string,
): Promise<void> {
  const [run, visits] = await Promise.all([
    deps.run(runId),
    deps.visits(runId),
  ]);

  if (!run || !creditFailureOf(visits)) {
    return;
  }
  const repo = loreRepoOf(run.repo);

  await deps.pauseLoop(repo, key, {
    reason: CREDIT_PAUSE_REASON,
    run_id: runId,
    at: deps.now().toISOString(),
    until: null,
  });
  console.warn(
    `[run-settled] paused the ${key} loop on ${repo}: ${CREDIT_PAUSE_REASON} (run ${runId})`,
  );
}
