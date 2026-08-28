/**
 * The Agent-CR watch as an `EventInput`: a WATCH stream on the Kubernetes API
 * that reports `kubernetes.agent{,_node}.{succeeded,failed}` on terminal phase
 * transitions.
 *
 * Kubernetes pushes object changes down one long-lived connection this process
 * opens — nothing calls in. That is the whole reason this lives beside a
 * satellite cluster's API server rather than beside the database (ADR-044): the
 * API is only reachable from inside its own cluster.
 *
 * This file is the CONNECTION — reconnect, backoff, catch-up. What to do with a
 * CR once it arrives lives in `agent-reporting.ts`, which is testable without a
 * cluster; only the shell here is not. The retry ladder that used to sit
 * between them now lives in the shared `EventProxy` this registers with.
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
import type {
  Emit,
  EventInput,
} from "@re-cinq/lore-shared/project/events/event-input-port.js";
import {
  forEachAgentPage,
  reportForAgent,
  GROUP,
  VERSION,
  PLURAL,
  type WatchDeps,
} from "./agent-reporting.js";

export type { WatchDeps };

const MAX_BACKOFF_MS = 30_000;
/** A chain this long means the proxy has been unable to drain for a while. The
 *  watch cannot refuse a callback, so the depth is the only place the pressure
 *  is visible before the pod's memory is. */
const CHAIN_WARN_DEPTH = 100;

function watchPath(): string {
  return `/apis/${GROUP}/${VERSION}/namespaces/${agentsNamespace()}/${PLURAL}`;
}

export class AgentWatchInput implements EventInput {
  readonly name = "agent-watch";
  private running = false;
  private backoffMs = 1000;
  /**
   * Observed CRs are reported through one promise chain, not fired in parallel.
   *
   * `Watch`'s callback is synchronous and cannot be awaited, so the chain is
   * what turns the proxy's blocking `emit` into real backpressure: while the
   * queue is full the chain stops advancing instead of every CR racing for a
   * slot and arriving out of order. The chain itself is the one unbounded part
   * — a router down long enough grows it — which is why its depth is logged,
   * and why every event it carries has a dedupe key: dropping the pod and
   * re-listing on reconnect is a safe recovery, not a lossy one.
   */
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;

  start(emit: Emit): void {
    if (selectStationBackend(process.env) !== "k8s") {
      console.log(
        "[cluster-agent] k8s watch disabled (station backend is not k8s)",
      );

      return;
    }
    this.running = true;
    console.log("[cluster-agent] k8s Agent-CR watch started");
    void this.watchForever({ emit });
  }

  stop(): Promise<void> {
    this.running = false;

    return this.chain;
  }

  /** Queue one CR behind everything observed before it. */
  private observe(agent: AgentCr, deps: WatchDeps): void {
    this.depth++;

    if (this.depth === CHAIN_WARN_DEPTH) {
      console.warn(
        `[cluster-agent] ${CHAIN_WARN_DEPTH} observed CRs are waiting to be queued — the event proxy is not draining`,
      );
    }
    this.chain = this.chain
      .then(() => reportForAgent(agent, deps))
      .finally(() => {
        this.depth--;
      });
  }

  private async watchForever(deps: WatchDeps): Promise<void> {
    while (this.running) {
      try {
        await this.watchOnce(deps);
        this.backoffMs = 1000; // clean end → reset backoff
      } catch (err) {
        console.error(
          `[cluster-agent] k8s watch dropped (reconnect in ${this.backoffMs}ms):`,
          (err as Error).message,
        );
      }
      await new Promise((r) => setTimeout(r, this.backoffMs));
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  private async watchOnce(deps: WatchDeps): Promise<void> {
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
              this.observe(obj, deps);
            }
          },
          (err: unknown) => (err ? reject(err) : resolve()),
        )
        .catch(reject);
    });
  }
}
