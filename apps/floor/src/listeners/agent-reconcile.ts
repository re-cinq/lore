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
 *     no other reason to know. The Floor holds that state; the cluster reads it
 *     needs go through the cluster agent.
 *
 * Re-emits go through the router like every other Floor-side report; a backstop
 * does not get to bypass the one writer.
 */

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { HttpAgentApi } from "@re-cinq/lore-shared";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import { forEachPage } from "@re-cinq/lore-shared/lib/paginate.js";
import { clusterAgent, pipeline, taskStore } from "../kernel/queues.js";
import { insertEvent } from "../main-loop/store.js";

const PRUNE_AFTER_MS = 60 * 60 * 1000;
const LIST_PAGE_LIMIT = 50;

/** The one call the paged walk makes. Narrowed from a CustomObjectsApi slice to
 *  exactly this, so a test fakes one method rather than a Kubernetes client. */
export interface AgentLister {
  listPage(opts: {
    limit: number;
    continue?: string;
  }): Promise<{ items: AgentCr[]; continueToken?: string }>;
}

/**
 * Walk the Agent CRs one page at a time.
 * Never holds (or JSON.parses) the whole namespace at once: 180 accumulated CRs
 * (~1.4MB of status each) in a single unpaginated LIST blew Node's heap and
 * crash-looped the Floor on 2026-07-24 — and because the pruner only ran inside
 * that same list pass, the pile could never shrink again.
 */
export async function forEachAgentPage(
  lister: AgentLister,
  onPage: (items: AgentCr[]) => Promise<void>,
): Promise<void> {
  await forEachPage<AgentCr>(
    (continueToken) =>
      lister.listPage({ limit: LIST_PAGE_LIMIT, continue: continueToken }),
    onPage,
  );
}

/** Safety net: list CRs, re-emit for terminal ones whose work is still in flight, prune old. */
export async function reconcileAgents(
  cluster: HttpAgentApi = new HttpAgentApi(clusterAgent()),
): Promise<void> {
  await forEachAgentPage(cluster, async (agents) => {
    for (const agent of agents) {
      await reconcileAgent(agent, cluster);
    }
  });
}

async function reconcileAgent(
  agent: AgentCr,
  cluster: HttpAgentApi,
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
  await pruneIfOld(agent, cluster);
}

/** Delete a terminal CR an hour after it finished.
 *
 *  The delete goes through the cluster agent, whose Role actually grants it. The
 *  Floor's never did — `agent-launcher` has create/get/list/watch and no
 *  `delete` — so every prune since this pass was written has been a swallowed
 *  403, which is why the pile the header describes could never shrink. */
async function pruneIfOld(
  agent: AgentCr,
  cluster: HttpAgentApi,
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
  await cluster
    .remove(name)
    .catch((err) =>
      console.warn(
        `[agent-reconcile] prune of ${name} failed:`,
        (err as Error).message,
      ),
    );
}
