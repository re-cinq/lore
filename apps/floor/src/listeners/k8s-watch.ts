/**
 * Layer-1 Kubernetes listener: a WATCH stream on Agent CRs that emits
 * `kubernetes.agent.{succeeded,failed}` on terminal phase transitions (replacing
 * the every-minute poll). The loop dispatches; the handler re-GETs the CR and runs
 * `processAgentCr`. A reconcile pass (the `cron.agent_watcher_reconcile.tick`
 * handler) is the belt-and-suspenders for dropped watch events + prunes old CRs.
 * Dedupe (`k8s:taskId:phase`) makes the catch-up + reconcile re-emits no-ops.
 */

import { KubeConfig, Watch, CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent } from "@re-cinq/agent-contracts";
import { query } from "../kernel/db.js";
import { insertEvent } from "../main-loop/store.js";
import { mapAgentToEvent } from "./k8s-map.js";
import { makeAgentsApi } from "../watcher/agent-watcher.js";

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

async function emitForAgent(agent: Agent): Promise<void> {
  const ev = mapAgentToEvent(agent as never);
  if (!ev) return;
  await insertEvent(ev).catch((err) => console.error("[events] k8s emit failed:", (err as Error).message));
}

/** Safety net: list CRs, emit for terminal ones whose task is still in flight, prune old. */
export async function reconcileAgents(): Promise<void> {
  const { k8sApi, namespace } = makeAgentsApi();
  const result = (await k8sApi.listNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL })) as { items?: Agent[] };
  for (const agent of result.items ?? []) {
    const ev = mapAgentToEvent(agent as never);
    if (ev) {
      const taskId = String((ev.params ?? {}).taskId ?? "");
      const dbStatus = taskId
        ? (await query<{ status: string }>(`SELECT status FROM pipeline.tasks WHERE id = $1`, [taskId]))[0]?.status
        : undefined;
      if (dbStatus && ["running", "queued"].includes(dbStatus)) await insertEvent(ev).catch(() => {});
    }
    await pruneIfOld(agent, k8sApi, namespace);
  }
}

async function pruneIfOld(agent: Agent, k8sApi: CustomObjectsApi, namespace: string): Promise<void> {
  const status = agent.status ?? {};
  if (status.phase !== "Succeeded" && status.phase !== "Failed") return;
  const completedAt = status.completedAt ? new Date(status.completedAt) : null;
  if (!completedAt || Date.now() - completedAt.getTime() <= PRUNE_AFTER_MS) return;
  const name = agent.metadata?.name;
  if (!name) return;
  await k8sApi
    .deleteNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name })
    .catch(() => {});
}

let backoffMs = 1000;

/** Start the watch (no-op outside the cluster, e.g. local `npm start`). */
export function startK8sWatch(): void {
  if (!process.env.KUBERNETES_SERVICE_HOST) {
    console.log("[events] k8s watch disabled (not running in a cluster)");
    return;
  }
  console.log("[events] k8s Agent-CR watch started");
  void runWatchForever();
}

async function runWatchForever(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      await watchOnce();
      backoffMs = 1000; // clean end → reset backoff
    } catch (err) {
      console.error(`[events] k8s watch dropped (reconnect in ${backoffMs}ms):`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

async function watchOnce(): Promise<void> {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  // Seed resourceVersion + catch up on terminal CRs we may have missed while down.
  const { k8sApi, namespace } = makeAgentsApi();
  const list = (await k8sApi.listNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL })) as {
    items?: Agent[];
    metadata?: { resourceVersion?: string };
  };
  for (const agent of list.items ?? []) await emitForAgent(agent);
  const resourceVersion = list.metadata?.resourceVersion;

  const watch = new Watch(kc);
  await new Promise<void>((resolve, reject) => {
    watch
      .watch(
        watchPath(),
        { resourceVersion, allowWatchBookmarks: true },
        (type: string, obj: Agent) => {
          if (type === "ADDED" || type === "MODIFIED") void emitForAgent(obj);
        },
        (err: unknown) => (err ? reject(err) : resolve()),
      )
      .catch(reject);
  });
}
