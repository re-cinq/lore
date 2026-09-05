/** Layer-3 handlers for kubernetes.agent.* events (Succeeded/Failed share one processor). The event is the whole input — no CR re-read, since that made settling conditional on reaching the run's own cluster; params that don't describe a terminal run are dropped rather than guessed at. */

import { agentTerminalReport } from "./watcher/agent-watcher-logic.js";
import { processAgentTerminal } from "./watcher/agent-watcher.js";
import type { EventHandler } from "../kernel/event-types.js";

const handleAgent: EventHandler = async (params) => {
  const report = agentTerminalReport(params);

  if (!report) {
    return;
  }
  await processAgentTerminal(report);
};

export const agentSucceeded = handleAgent;
export const agentFailed = handleAgent;
