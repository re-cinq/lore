/**
 * The Agent-CR watch: a WATCH stream on the Kubernetes API that reports
 * `kubernetes.agent{,_node}.{succeeded,failed}` on terminal phase transitions.
 *
 * Kubernetes pushes object changes down one long-lived connection this process
 * opens — nothing calls in. That is the whole reason this lives beside a
 * satellite cluster's API server rather than beside the database (ADR-044): the
 * API is only reachable from inside its own cluster.
 *
 * Writes go through the same insert the route's reporting branch uses. Posting
 * to our own HTTP endpoint would be a loopback round-trip for a row we are
 * already holding the pool for.
 *
 * This file is the CONNECTION — reconnect, backoff, catch-up. What to do with a
 * CR once it arrives lives in `agent-reporting.ts`, which is testable without a
 * cluster; only the shell here is not.
 *
 * The reconcile + prune safety net is deliberately NOT here — it stays on the
 * Floor. A backstop in the same process as the watch it backs up dies with it,
 * and its "is this run still open" question reads business state this service
 * has no other reason to know.
 */

import { KubeConfig, Watch, CustomObjectsApi } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import {
  agentsNamespace,
  loadKube,
  selectStationBackend,
} from "@re-cinq/lore-shared";
import {
  forEachAgentPage,
  reportForAgent,
  GROUP,
  VERSION,
  PLURAL,
  type WatchDeps,
} from "./agent-reporting.js";

export type { WatchDeps };

function watchPath(): string {
  return `/apis/${GROUP}/${VERSION}/namespaces/${agentsNamespace()}/${PLURAL}`;
}

let backoffMs = 1000;

/** Start the watch. No-op when this process has no cluster to watch. */
export function startK8sWatch(deps: WatchDeps): void {
  if (selectStationBackend(process.env) !== "k8s") {
    console.log(
      "[cluster-agent] k8s watch disabled (station backend is not k8s)",
    );

    return;
  }
  console.log("[cluster-agent] k8s Agent-CR watch started");
  void runWatchForever(deps);
}

async function runWatchForever(deps: WatchDeps): Promise<void> {
  for (;;) {
    try {
      await watchOnce(deps);
      backoffMs = 1000; // clean end → reset backoff
    } catch (err) {
      console.error(
        `[cluster-agent] k8s watch dropped (reconnect in ${backoffMs}ms):`,
        (err as Error).message,
      );
    }
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 30_000);
  }
}

async function watchOnce(deps: WatchDeps): Promise<void> {
  const kc = new KubeConfig();

  loadKube(kc);

  const k8sApi = kc.makeApiClient(CustomObjectsApi);
  const namespace = agentsNamespace();
  // Seed resourceVersion + catch up on terminal CRs missed while down —
  // paginated for the same reason the reconcile pass is.
  const resourceVersion = await forEachAgentPage(
    k8sApi,
    namespace,
    async (agents) => {
      for (const agent of agents) {
        await reportForAgent(agent, deps);
      }
    },
  );

  const watch = new Watch(kc);

  await new Promise<void>((resolve, reject) => {
    watch
      .watch(
        watchPath(),
        { resourceVersion, allowWatchBookmarks: true },
        (type: string, obj: AgentCr) => {
          if (type === "ADDED" || type === "MODIFIED") {
            void reportForAgent(obj, deps);
          }
        },
        (err: unknown) => (err ? reject(err) : resolve()),
      )
      .catch(reject);
  });
}
