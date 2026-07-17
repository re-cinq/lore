/**
 * Layer-1 Kubernetes listener: a WATCH stream on Agent CRs that emits
 * `kubernetes.agent.{succeeded,failed}` on terminal phase transitions (replacing
 * the every-minute poll). The loop dispatches; the handler re-GETs the CR and runs
 * `processAgentCr`. A reconcile pass (the `cron.agent_watcher_reconcile.tick`
 * handler) is the belt-and-suspenders for dropped watch events + prunes old CRs.
 * Dedupe (`k8s:taskId:phase`) makes the catch-up + reconcile re-emits no-ops.
 */

import { KubeConfig, Watch, CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { loadKube, selectStationBackend } from "@re-cinq/lore-shared";
import { taskStore, assemblyLines } from "../kernel/queues.js";
import { insertEvent } from "../main-loop/store.js";
import { mapAgentToEvent } from "./k8s-map.js";
import { makeAgentsApi } from "../jobs/watcher/agent-watcher.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";
const PRUNE_AFTER_MS = 60 * 60 * 1000;

function ns(): string {
  return process.env.LORE_AGENTS_NAMESPACE ?? "ai-agents";
}
function watchPath(): string {
  return `/apis/${GROUP}/${VERSION}/namespaces/${ns()}/${PLURAL}`;
}

async function emitForAgent(agent: AgentCr): Promise<void> {
  const ev = mapAgentToEvent(agent as never);

  if (!ev) {
    return;
  }
  await insertEvent(ev).catch((err) =>
    console.error("[events] k8s emit failed:", (err as Error).message),
  );
}

/** Safety net: list CRs, emit for terminal ones whose task is still in flight, prune old. */
export async function reconcileAgents(): Promise<void> {
  const { k8sApi, namespace } = makeAgentsApi();
  const result = (await k8sApi.listNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace,
    plural: PLURAL,
  })) as { items?: AgentCr[] };

  for (const agent of result.items ?? []) {
    const ev = mapAgentToEvent(agent as never);

    if (ev && ev.eventName.startsWith("kubernetes.agent_node.")) {
      // Node CRs guard on the assembly-line ROW, not a task (task-less lines
      // have none): re-emit while the line is still open. Dedupe rows persist
      // ~7 days, so a handled event's re-emit is a no-op — recovery for a
      // dead-lettered transition is the assembly-line reaper, not this pass.
      const assemblyLineId = String((ev.params ?? {}).assemblyLineId ?? "");
      const row = assemblyLineId
        ? await assemblyLines().getById(assemblyLineId)
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
}

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

let backoffMs = 1000;

/** Start the watch. Runs in the cluster, and on a laptop whenever the developer
 *  opted into the k8s station backend (`LORE_STATION_BACKEND=k8s`) — that Floor
 *  dispatches Agent CRs to minikube, so it needs their terminal events too.
 *  No-op otherwise (a plain `npm start` has no cluster to watch). */
export function startK8sWatch(): void {
  if (selectStationBackend(process.env) !== "k8s") {
    console.log("[events] k8s watch disabled (station backend is not k8s)");

    return;
  }
  console.log("[events] k8s Agent-CR watch started");
  void runWatchForever();
}

async function runWatchForever(): Promise<void> {
  for (;;) {
    try {
      await watchOnce();
      backoffMs = 1000; // clean end → reset backoff
    } catch (err) {
      console.error(
        `[events] k8s watch dropped (reconnect in ${backoffMs}ms):`,
        (err as Error).message,
      );
    }
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

async function watchOnce(): Promise<void> {
  const kc = new KubeConfig();

  loadKube(kc);
  // Seed resourceVersion + catch up on terminal CRs we may have missed while down.
  const { k8sApi, namespace } = makeAgentsApi();
  const list = (await k8sApi.listNamespacedCustomObject({
    group: GROUP,
    version: VERSION,
    namespace,
    plural: PLURAL,
  })) as {
    items?: AgentCr[];
    metadata?: { resourceVersion?: string };
  };

  for (const agent of list.items ?? []) {
    await emitForAgent(agent);
  }
  const resourceVersion = list.metadata?.resourceVersion;

  const watch = new Watch(kc);

  await new Promise<void>((resolve, reject) => {
    watch
      .watch(
        watchPath(),
        { resourceVersion, allowWatchBookmarks: true },
        (type: string, obj: AgentCr) => {
          if (type === "ADDED" || type === "MODIFIED") {
            void emitForAgent(obj);
          }
        },
        (err: unknown) => (err ? reject(err) : resolve()),
      )
      .catch(reject);
  });
}
