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
 * to our own HTTP endpoint would be a round-trip through the loopback for a row
 * we are already holding the pool for.
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
  type EventInsert,
} from "@re-cinq/lore-shared";
import { mapAgentToEvent } from "@re-cinq/lore-shared/project/events/k8s-map.js";

const GROUP = "agents.re-cinq.com";
const VERSION = "v1alpha1";
const PLURAL = "agents";
const LIST_PAGE_LIMIT = 50;

export interface WatchDeps {
  insert: (event: EventInsert) => Promise<void>;
}

function watchPath(): string {
  return `/apis/${GROUP}/${VERSION}/namespaces/${agentsNamespace()}/${PLURAL}`;
}

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
 * crash-looped the Floor on 2026-07-24.
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

/** Map one observed CR and report it, if it is terminal. */
export async function reportForAgent(
  agent: AgentCr,
  deps: WatchDeps,
): Promise<void> {
  const ev = mapAgentToEvent(agent as never);

  if (!ev) {
    return;
  }
  await deps
    .insert(ev)
    .catch((err) =>
      console.error(
        "[event-router] k8s report failed:",
        (err as Error).message,
      ),
    );
}

let backoffMs = 1000;

/** Start the watch. No-op when this process has no cluster to watch. */
export function startK8sWatch(deps: WatchDeps): void {
  if (selectStationBackend(process.env) !== "k8s") {
    console.log(
      "[event-router] k8s watch disabled (station backend is not k8s)",
    );

    return;
  }
  console.log("[event-router] k8s Agent-CR watch started");
  void runWatchForever(deps);
}

async function runWatchForever(deps: WatchDeps): Promise<void> {
  for (;;) {
    try {
      await watchOnce(deps);
      backoffMs = 1000; // clean end → reset backoff
    } catch (err) {
      console.error(
        `[event-router] k8s watch dropped (reconnect in ${backoffMs}ms):`,
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
  // paginated for the same reason the list above is.
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
