import type { FloorClient } from "@re-cinq/floor-client";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** The small Floor surface a cancel needs: read the run, then cancel it. */
export type CancelRunFloor = Pick<FloorClient, "runs">;

export interface CancelRunAsk {
  runId: string;
  /** Who asked, named in the reason the floor records; absent when the caller did not say. */
  requestedBy?: string;
}

const FROM_RUN_PAGE = "cancelled from the run page";

export async function cancelRun(
  floor: CancelRunFloor,
  ask: CancelRunAsk,
): Promise<{ runId: string }> {
  const found = await floor.runs.get(ask.runId);

  enforceTrue(found, apiError(404), `the floor has no run ${ask.runId}`);
  enforceTrue(
    found.run.finishedAt === null,
    apiError(409),
    `run ${ask.runId} already finished`,
  );

  await floor.runs.cancel(ask.runId, reasonFor(ask.requestedBy));

  return { runId: ask.runId };
}

function reasonFor(requestedBy: string | undefined): string {
  return requestedBy ? `${FROM_RUN_PAGE} by ${requestedBy}` : FROM_RUN_PAGE;
}
