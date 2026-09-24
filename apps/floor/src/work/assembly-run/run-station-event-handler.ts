// Handler for `assembly_run.run_station`: a person ran one station of a run by hand (specs/fork-rerun-from-node FR8). lore-api validated the ask and reopened the run; the Floor launches the node, since only the Floor resolves a dispatch.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { EventHandler } from "../../domain/event-types.js";
import type { HandRun } from "./run-station-by-hand.js";

/** The run and the hand-run an event names; a missing field throws, since without it there is nothing to launch. */
export function handRunFrom(params: Record<string, unknown>): {
  assemblyRunId: string;
  handRun: HandRun;
} {
  const { assemblyRunId, nodeId, actor } = params;

  enforceTrue(
    typeof assemblyRunId === "string" &&
      typeof nodeId === "string" &&
      typeof actor === "string",
    Error,
    "assembly_run.run_station event params need assemblyRunId, nodeId and actor",
  );

  return {
    assemblyRunId: assemblyRunId as string,
    handRun: { nodeId: nodeId as string, actor: actor as string },
  };
}

/** Composed production handler; deps resolved lazily so importing the registry never forces the DB pool or K8s client. */
export const assemblyRunStation: EventHandler = async (params) => {
  const [queues, byHand, nodeEvents, reopen] = await Promise.all([
    import("../../outbound/queues.js"),
    import("./run-station-by-hand.js"),
    import("./node-event-handler.js"),
    import("./reopen-task.js"),
  ]);
  const { assemblyRunId, handRun } = handRunFrom(params);
  const deps = await nodeEvents.productionNodeEventDeps();

  await byHand.runStationByHand(assemblyRunId, handRun, {
    ...deps,
    reopenTask: async (runId) => {
      const run = await deps.assemblyRuns.getById(runId);

      if (run) {
        await reopen.reopenTaskForFork(
          run,
          { tasks: queues.taskStore() },
          "run-station",
        );
      }
    },
  });
};
