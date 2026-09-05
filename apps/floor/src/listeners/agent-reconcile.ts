// The Agent-CR reconcile + prune pass — the safety net behind the event-router's watch (ADR-044). Stays on the FLOOR (a backstop sharing the router's process would die with it) and re-emits through the router like every other report.

import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { HttpAgentApi } from "@re-cinq/lore-shared";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";
import { forEachPage } from "@re-cinq/lore-shared/lib/paginate.js";
import { clusterAgent, pipeline, taskStore } from "../kernel/queues.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { emitEvent } from "../kernel/event-store.js";

const PRUNE_AFTER_MS = 60 * 60 * 1000;
const LIST_PAGE_LIMIT = 50;

/** Narrowed from CustomObjectsApi: test fakes one method vs full Kubernetes client. */
export interface AgentLister {
  listPage(opts: {
    limit: number;
    continue?: string;
  }): Promise<{ items: AgentCr[]; continueToken?: string }>;
}

/** Never holds the whole namespace at once — 180 accumulated CRs in one unpaginated LIST blew Node's heap and crash-looped the Floor on 2026-07-24. */
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
  // Pagination bounds MEMORY; CRs WITHIN a page run concurrently (allSettled, not all — one throwing CR must not abandon the whole sweep), each rejection logged rather than swallowed.
  await forEachAgentPage(cluster, async (agents) => {
    const settled = await Promise.allSettled(
      agents.map((agent) => reconcileAgent(agent, cluster)),
    );

    for (const [i, outcome] of settled.entries()) {
      if (outcome.status === "rejected") {
        console.warn(
          `[agent-reconcile] ${agents[i].metadata?.name} not reconciled:`,
          errorMessage(outcome.reason),
        );
      }
    }
  });
}

async function reconcileAgent(
  agent: AgentCr,
  cluster: HttpAgentApi,
): Promise<void> {
  const ev = mapAgentToEvent(agent as never);

  if (ev) {
    await reemitWhileSubjectOpen(ev);
  }
  await pruneIfOld(agent, cluster);
}

/** Re-emit a terminal event while its subject (assembly-line row for a node CR, task for a single-CR run) is still open. */
async function reemitWhileSubjectOpen(
  ev: NonNullable<ReturnType<typeof mapAgentToEvent>>,
): Promise<void> {
  if (ev.eventName.startsWith("kubernetes.agent_node.")) {
    await reemitWhileLineOpen(ev);

    return;
  }
  await reemitWhileTaskOpen(ev);
}

/** One string param off the event, or "" when the params object or the key is missing. */
function eventParamString(
  ev: NonNullable<ReturnType<typeof mapAgentToEvent>>,
  key: string,
): string {
  return String((ev.params ?? {})[key] ?? "");
}

/** Node CRs guard on the assembly-line ROW, not a task — dedupe rows persist ~7 days so a handled event's re-emit is a no-op; the reaper handles dead-lettered transitions. */
async function reemitWhileLineOpen(
  ev: NonNullable<ReturnType<typeof mapAgentToEvent>>,
): Promise<void> {
  const assemblyLineId = eventParamString(ev, "assemblyLineId");
  const row = assemblyLineId
    ? await pipeline().assemblyRuns.getById(assemblyLineId)
    : null;

  if (row && ["running", "queued"].includes(row.status)) {
    await emitEvent(ev);
  }
}

/** Single-CR runs guard on the task row instead. */
async function reemitWhileTaskOpen(
  ev: NonNullable<ReturnType<typeof mapAgentToEvent>>,
): Promise<void> {
  const taskId = eventParamString(ev, "taskId");
  const dbStatus = taskId
    ? (await taskStore().getById(taskId))?.status
    : undefined;

  if (dbStatus && ["running", "queued"].includes(dbStatus)) {
    await emitEvent(ev);
  }
}

/** The CR's completion time, or null when it hasn't reached a terminal phase yet. */
function terminalCompletedAt(status: {
  phase?: string;
  completedAt?: string;
}): Date | null {
  if (status.phase !== "Succeeded" && status.phase !== "Failed") {
    return null;
  }

  return status.completedAt ? new Date(status.completedAt) : null;
}

/** Delete a terminal CR an hour after it finished — through the cluster agent, whose Role grants delete (the Floor's `agent-launcher` never did, only create/get/list/watch). */
async function pruneIfOld(
  agent: AgentCr,
  cluster: HttpAgentApi,
): Promise<void> {
  const completedAt = terminalCompletedAt(agent.status ?? {});

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
