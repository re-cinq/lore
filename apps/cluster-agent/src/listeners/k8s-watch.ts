// The Agent-CR watch as an `EventInput`: a long-lived WATCH stream reporting kubernetes.agent{,_node}.{succeeded,failed} on terminal phase (ADR-044, CONNECTION only — mapping lives in agent-reporting.ts). The reconcile+prune safety net deliberately stays on the Floor, not here.

import { Watch } from "@kubernetes/client-node";
import type { Agent as AgentCr } from "@re-cinq/agent-contracts";
import { agentsNamespace, errorMessage } from "@re-cinq/lore-shared";
import type {
  Emit,
  EventInput,
} from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { customObjectsApi, kubeConfig } from "../kernel/kube-clients.js";
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
/** A chain this long means the proxy has been unable to drain for a while — the depth is the only visible pressure before the pod's memory is. */
const CHAIN_WARN_DEPTH = 100;

function watchPath(): string {
  return `/apis/${GROUP}/${VERSION}/namespaces/${agentsNamespace()}/${PLURAL}`;
}

export class AgentWatchInput implements EventInput {
  readonly name = "agent-watch";
  private running = false;
  private backoffMs = 1000;
  /** Observed CRs are reported through one promise chain, not parallel — `Watch`'s sync callback turns the proxy's blocking `emit` into real backpressure. */
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;

  start(emit: Emit): void {
    // No backend gate here — startClaimLoop already refuses to boot unless the backend is k8s, and runs before this input registers.
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
          errorMessage(err),
        );
      }
      await new Promise((r) => setTimeout(r, this.backoffMs));
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  private async watchOnce(deps: WatchDeps): Promise<void> {
    const kc = kubeConfig();
    const k8sApi = customObjectsApi();
    const namespace = agentsNamespace();
    // Seed resourceVersion + catch up on terminal CRs missed while down — paginated for the same reason the reconcile pass is.
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
          (type: string, cr: AgentCr) => {
            if (type === "ADDED" || type === "MODIFIED") {
              this.observe(cr, deps);
            }
          },
          (err: unknown) => (err ? reject(err) : resolve()),
        )
        .catch(reject);
    });
  }
}
