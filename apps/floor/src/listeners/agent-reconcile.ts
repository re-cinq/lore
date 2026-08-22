/**
 * The Agent-CR reconcile + prune pass — the safety net behind the event-router's
 * watch (ADR-044), run from the `cron.agent_watcher_reconcile.tick` handler.
 *
 * It stays on the FLOOR while the watch itself moved out, and the reasons are
 * two:
 *
 *   - A backstop that shares a process with the thing it backs up dies with it.
 *     A wedged router would take the watch and its own safety net down together,
 *     which is the one failure this pass exists to survive.
 *   - Deciding whether a terminal CR is still worth re-emitting reads business
 *     state — is this run open, is this task still running — that the router has
 *     no other reason to know. The Floor already holds both that state and a
 *     Kubernetes client for dispatch, so the pass costs it a list and nothing
 *     more.
 *
 * Re-emits go through the router like every other Floor-side report; a backstop
 * does not get to bypass the one writer.
 */

import type { CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { agentsNamespace } from "@re-cinq/lore-shared";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import { pipeline, taskStore } from "../kernel/queues.js";
import { insertEvent } from "../main-loop/store.js";
import { makeAgentsApi } from "../jobs/watcher/agent-watcher.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";
const PRUNE_AFTER_MS = 60 * 60 * 1000;
const LIST_PAGE_LIMIT = 50;

/** The slice of CustomObjectsApi the paginated list needs; tests fake this. */
export type AgentLister = Pick<CustomObjectsApi, "listNamespacedCustomObject">;

interface AgentListPage {
  items?: AgentCr[];
  // The wire field is `continue`; custom-object responses are raw JSON, but the
  // client's model mapper would surface `_continue` — read whichever is present.
  metadata?: {
    continue?: string;
    _continue?: string;
    resourceVersion?: string;
  };
}

/**
 * Walk the Agent CRs one page at a time, returning the list's resourceVersion.
 * Never holds (or JSON.parses) the whole namespace at once: 180 accumulated CRs
 * (~1.4MB of status each) in a single unpaginated LIST blew Node's heap and
 * crash-looped the Floor on 2026-07-24 — and because the pruner only ran inside
 * that same list pass, the pile could never shrink again.
 */
export async function forEachAgentPage(
  k8sApi: AgentLister,
  namespace: string,
  onPage: (items: AgentCr[]) => Promise<void>,
): Promise<string | undefined> {
  let continueToken: string | undefined;
  let resourceVersion: string | undefined;

  do {
    const page = (await k8sApi.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      limit: LIST_PAGE_LIMIT,
      _continue: continueToken,
    })) as AgentListPage;

    await onPage(page.items ?? []);
    continueToken = page.metadata?._continue ?? page.metadata?.continue;
    resourceVersion = page.metadata?.resourceVersion ?? resourceVersion;
  } while (continueToken);

  return resourceVersion;
}

/** Safety net: list CRs, re-emit for terminal ones whose work is still in flight, prune old. */
export async function reconcileAgents(
  api: { k8sApi: CustomObjectsApi; namespace: string } = makeAgentsApi(),
): Promise<void> {
  const { k8sApi, namespace } = api;

  await forEachAgentPage(k8sApi, namespace, async (agents) => {
    for (const agent of agents) {
      await reconcileAgent(agent, k8sApi, namespace);
    }
  });
}

async function reconcileAgent(
  agent: AgentCr,
  k8sApi: CustomObjectsApi,
  namespace: string,
): Promise<void> {
  const ev = mapAgentToEvent(agent as never);

  if (ev && ev.eventName.startsWith("kubernetes.agent_node.")) {
    // Node CRs guard on the assembly-line ROW, not a task (task-less lines
    // have none): re-emit while the line is still open. Dedupe rows persist
    // ~7 days, so a handled event's re-emit is a no-op — recovery for a
    // dead-lettered transition is the assembly-line reaper, not this pass.
    const assemblyLineId = String((ev.params ?? {}).assemblyLineId ?? "");
    const row = assemblyLineId
      ? await pipeline().assemblyRuns.getById(assemblyLineId)
      : null;

    if (row && ["running", "queued"].includes(row.status)) {
      await insertEvent(ev).catch(() => {});
    }
  } else if (ev) {
    const taskId = String((ev.params ?? {}).taskId ?? "");
    const dbStatus = taskId
      ? (await taskStore().getById(taskId))?.status
      : undefined;

    if (dbStatus && ["running", "queued"].includes(dbStatus)) {
      await insertEvent(ev).catch(() => {});
    }
  }
  await pruneIfOld(agent, k8sApi, namespace);
}

/** Delete a terminal CR an hour after it finished — cluster housekeeping, which
 *  is the Floor's own authority. */
async function pruneIfOld(
  agent: AgentCr,
  k8sApi: CustomObjectsApi,
  namespace: string,
): Promise<void> {
  const status = agent.status ?? {};

  if (status.phase !== "Succeeded" && status.phase !== "Failed") {
    return;
  }
  const completedAt = status.completedAt ? new Date(status.completedAt) : null;

  if (!completedAt || Date.now() - completedAt.getTime() <= PRUNE_AFTER_MS) {
    return;
  }
  const name = agent.metadata?.name;

  if (!name) {
    return;
  }
  await k8sApi
    .deleteNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      name,
    })
    .catch(() => {});
}

/** The namespace the pass lists, for callers building their own api handle. */
export { agentsNamespace };
