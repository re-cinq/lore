import * as k8s from "@kubernetes/client-node";
import { GROUP, VERSION, AGENTS_PLURAL, type Agent } from "./cr-types.js";
import { reconcileAgent, type ReconcileDeps } from "./reconcile.js";

/**
 * Watch Agent CRs and reconcile each (ADR-031). Mirrors the LoreTask controller:
 * a long-lived Watch for low latency + a 15s poll that catches anything the watch
 * misses. Reconcile errors are logged per-Agent; the loop keeps running.
 */

const POLL_INTERVAL_MS = 15_000;

export function startWatching(kc: k8s.KubeConfig, namespace: string, deps: ReconcileDeps): void {
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

  const reconcile = (agent: Agent) =>
    reconcileAgent(agent, namespace, deps).catch((err) =>
      console.error(`[controller] reconcile failed for ${agent.metadata?.name}: ${(err as Error).message}`),
    );

  async function pollAndReconcile(): Promise<void> {
    try {
      const res = (await customApi.listNamespacedCustomObject({
        group: GROUP, version: VERSION, namespace, plural: AGENTS_PLURAL,
      })) as unknown as { items: Agent[] };
      for (const agent of res.items ?? []) {
        const phase = agent.status?.phase;
        if (!phase || phase === "Pending" || phase === "Running") await reconcile(agent);
      }
    } catch (err) {
      console.error(`[controller] poll failed: ${(err as Error).message}`);
    }
  }

  const watch = new k8s.Watch(kc);
  const path = `/apis/${GROUP}/${VERSION}/namespaces/${namespace}/${AGENTS_PLURAL}`;
  function doWatch(): void {
    watch
      .watch(
        path,
        {},
        (type: string, agent: Agent) => {
          if (type === "ADDED" || type === "MODIFIED") void reconcile(agent);
        },
        (err) => {
          if (err) console.error(`[controller] watch error: ${(err as Error).message}`);
          setTimeout(doWatch, 5_000); // reconnect
        },
      )
      .then(() => console.log("[controller] watch established"))
      .catch((err) => {
        console.error(`[controller] watch setup failed: ${(err as Error).message}`);
        setTimeout(doWatch, 5_000);
      });
  }

  doWatch();
  setInterval(() => void pollAndReconcile(), POLL_INTERVAL_MS);
  void pollAndReconcile();
}
