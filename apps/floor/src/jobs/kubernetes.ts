/**
 * Layer-3 handlers for kubernetes.agent.* events. The event carries the agent
 * name; we re-read the fresh CR (so status is current) and run the shared
 * `processAgentCr`. Succeeded and Failed map to the same processor — it branches
 * on the CR phase internally.
 *
 * The read goes through the cluster agent, which answers `found:false` for a CR
 * that no longer exists. That replaces the old 404-sniffing: "already pruned" is
 * now an ordinary answer rather than an error class this file had to classify,
 * and any REAL failure (RBAC, apiserver 5xx, network) throws so the loop retries
 * instead of silently marking the event handled.
 */

import { HttpAgentApi } from "@re-cinq/lore-shared";
import { processAgentCr } from "./watcher/agent-watcher.js";
import { clusterAgent } from "../kernel/queues.js";
import type { EventHandler } from "../main-loop/types.js";

const handleAgent: EventHandler = async (params) => {
  const { agentName } = params as { agentName?: string };

  if (!agentName) {
    return;
  }
  const cluster = new HttpAgentApi(clusterAgent());
  const cr = await cluster.get(agentName);

  if (!cr) {
    return;
  }
  await processAgentCr(cr, cluster);
};

export const agentSucceeded = handleAgent;
export const agentFailed = handleAgent;
