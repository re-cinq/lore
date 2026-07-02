/**
 * Layer-3 handlers for kubernetes.agent.* events. The event carries the agent
 * name; we re-GET the fresh CR (so status is current) and run the shared
 * `processAgentCr`. Succeeded and Failed map to the same processor — it branches
 * on the CR phase internally.
 */

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { makeAgentsApi, processAgentCr } from "./watcher/agent-watcher.js";
import type { EventHandler } from "../main-loop/types.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";

/** A missing CR (404) is a legitimate "already pruned" signal; any other status
 * (RBAC 403, apiserver 5xx, network) must surface so the loop retries/dead-letters
 * instead of silently marking the event handled. */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; response?: { statusCode?: number } };
  return e?.code === 404 || e?.response?.statusCode === 404;
}

const handleAgent: EventHandler = async (params) => {
  const { agentName } = params as { agentName?: string };
  if (!agentName) return;
  const { k8sApi, namespace } = makeAgentsApi();
  const cr = (await k8sApi
    .getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name: agentName })
    .catch((err: unknown) => {
      if (isNotFound(err)) return null; // CR already pruned — nothing to do
      throw err;
    })) as AgentCr | null;
  if (!cr) return;
  await processAgentCr(cr, k8sApi);
};

export const agentSucceeded = handleAgent;
export const agentFailed = handleAgent;
