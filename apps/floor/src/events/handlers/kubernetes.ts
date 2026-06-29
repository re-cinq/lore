/**
 * Layer-3 handlers for kubernetes.agent.* events. The event carries the agent
 * name; we re-GET the fresh CR (so status is current) and run the shared
 * `processAgentCr`. Succeeded and Failed map to the same processor — it branches
 * on the CR phase internally.
 */

import type { Agent } from "@re-cinq/agent-contracts";
import { makeAgentsApi, processAgentCr } from "../../watcher/agent-watcher.js";
import type { EventHandler } from "../types.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

const handleAgent: EventHandler = async (params) => {
  const { agentName } = params as { agentName?: string };
  if (!agentName) return;
  const { k8sApi, namespace } = makeAgentsApi();
  const cr = (await k8sApi
    .getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name: agentName })
    .catch(() => null)) as Agent | null;
  if (!cr) return; // CR already pruned — nothing to do
  await processAgentCr(cr, k8sApi);
};

export const agentSucceeded = handleAgent;
export const agentFailed = handleAgent;
