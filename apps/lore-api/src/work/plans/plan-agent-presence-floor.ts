// The planning agent's presence following the external floor this process is configured with.
import type { FloorClient } from "@re-cinq/floor-client";
import {
  PLANNING_LINE,
  PlanAgentPresence,
  type PresenceWriter,
} from "./plan-agent-presence.js";

const RUNS_PER_PAGE = 100;

export function planAgentPresenceOn(
  floor: Pick<FloorClient, "runs" | "stationRuns">,
  writer: PresenceWriter,
): PlanAgentPresence {
  return new PlanAgentPresence({
    watchFloor: () => floor.runs.watchFloor(),
    readRun: async (runId) => {
      const found = await floor.runs.get(runId);

      return found
        ? {
            run: found.run,
            visits: await floor.stationRuns.list({ run: runId }),
          }
        : null;
    },
    openPlanningRuns: () => openPlanningRunIds(floor),
    writer,
  });
}

async function openPlanningRunIds(
  floor: Pick<FloorClient, "runs">,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await floor.runs.list(
      { line: PLANNING_LINE, open: true },
      { limit: RUNS_PER_PAGE, cursor },
    );

    ids.push(...page.items.map((run) => run.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return ids;
}
