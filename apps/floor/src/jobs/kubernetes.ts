/**
 * Layer-3 handlers for kubernetes.agent.* events. Succeeded and Failed map to
 * the same processor — it branches on the phase internally.
 *
 * The event is the whole input. This handler used to re-read the CR through the
 * cluster agent "so status is current", which made settling a run conditional on
 * the Floor being able to reach the cluster that ran it — true of exactly one
 * cluster. `mapAgentToEvent` already reports the full status alongside the name
 * (it was changed to, for this reason), so the re-read bought nothing and cost
 * every run executed elsewhere.
 *
 * Params that do not describe a terminal run are dropped rather than guessed at:
 * a missing task id or a non-terminal phase settles nothing, and an event whose
 * shape is wrong must not be able to close a task from a default.
 */

import { agentTerminalReport } from "./watcher/agent-watcher-logic.js";
import { processAgentTerminal } from "./watcher/agent-watcher.js";
import type { EventHandler } from "../main-loop/types.js";

const handleAgent: EventHandler = async (params) => {
  const report = agentTerminalReport(params);

  if (!report) {
    return;
  }
  await processAgentTerminal(report);
};

export const agentSucceeded = handleAgent;
export const agentFailed = handleAgent;
