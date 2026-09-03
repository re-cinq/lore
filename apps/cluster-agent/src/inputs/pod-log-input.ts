// `PodLogInput` — follows this cluster's running pods and emits their stdout (CONNECTION half; decisions live in pod-log-batching.ts). A satellite's run is invisible to both live-cluster reads and the Cloud Logging fallback otherwise. OFF BY DEFAULT (LORE_POD_LOG_STREAMING=1).

import { Writable } from "node:stream";
import { Log, type CoreV1Api, type KubeConfig } from "@kubernetes/client-node";
import { agentsNamespace, errorMessage } from "@re-cinq/lore-shared";
import type {
  Emit,
  EventInput,
} from "@re-cinq/lore-shared/project/events/event-input-port.js";
import {
  addLine,
  drain,
  drainAtEnd,
  emptyBatch,
  followTargets,
  pickPodToFollow,
  podLogEvent,
  type BatchLimits,
  type FollowableAgent,
  type PendingBatch,
  type PodLogTarget,
} from "./pod-log-batching.js";
import { forEachAgentPage } from "../listeners/agent-reporting.js";
import { podSelectorForJob } from "../kernel/kube-pod-logs.js";
import {
  coreApi,
  customObjectsApi,
  kubeConfig,
} from "../kernel/kube-clients.js";

/** Deliberately small — bounds what one chunk costs the bus, not what the pod may write. */
const LIMITS: BatchLimits = { maxLines: 200, maxBytes: 64 * 1024 };
const DISCOVERY_INTERVAL_MS = 15_000;
/** Flush a partial batch after this long, so a quiet pod's last lines are not stranded. */
const IDLE_FLUSH_MS = 10_000;

export function podLogStreamingEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.LORE_POD_LOG_STREAMING === "1";
}

/** One followed pod: its stream, its batch, and its per-pod sequence. */
interface Follower {
  abort: AbortController;
  timer: NodeJS.Timeout;
}

export class PodLogInput implements EventInput {
  readonly name = "pod-logs";
  private running = false;
  private discovery: NodeJS.Timeout | null = null;
  /** One discovery pass at a time — an overlapping pass would see the same agent as unfollowed and double-stream it (dedupe per (pod, seq) cannot collapse that). */
  private discovering = false;
  private readonly followers = new Map<string, Follower>();

  start(emit: Emit): void {
    this.running = true;
    console.log("[cluster-agent] pod-log streaming started");
    void this.discover(emit);
    this.discovery = setInterval(
      () => void this.discover(emit),
      DISCOVERY_INTERVAL_MS,
    );
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.discovery) {
      clearInterval(this.discovery);
      this.discovery = null;
    }

    for (const follower of this.followers.values()) {
      clearInterval(follower.timer);
      follower.abort.abort();
    }
    this.followers.clear();

    return Promise.resolve();
  }

  /** One discovery pass: open a stream for every running agent not already followed. Failures are logged, never thrown. */
  private async discover(emit: Emit): Promise<void> {
    if (this.discovering) {
      return;
    }
    this.discovering = true;

    try {
      const kc = kubeConfig();
      const namespace = agentsNamespace();
      const core = coreApi();

      // Page by page, holding NOTHING between them — accumulating the namespace into one array OOM-killed a satellite's cluster-agent for 21h and stranded its Agent-CR watch.
      await forEachAgentPage(customObjectsApi(), namespace, async (page) => {
        for (const agent of followTargets(
          page as FollowableAgent[],
          new Set(this.followers.keys()),
        )) {
          await this.followOne(kc, namespace, core, agent, emit);
        }
      });
    } catch (err) {
      console.error(
        "[cluster-agent] pod-log discovery failed:",
        errorMessage(err),
      );
    } finally {
      this.discovering = false;
    }
  }

  /** Find the pod for one agent and open its stream. */
  private async followOne(
    kc: KubeConfig,
    namespace: string,
    core: CoreV1Api,
    agent: { agentCrName: string; jobName: string },
    emit: Emit,
  ): Promise<void> {
    const pods = await core.listNamespacedPod({
      namespace,
      labelSelector: podSelectorForJob(agent.jobName),
    });
    // The CONTAINER is resolved here too, not defaulted — an empty container name 400s the log request.
    const chosen = pickPodToFollow(pods.items ?? []);

    // Re-checked against the LIVE map, not the filtered page — a pod list was awaited since then, and stop() may have run too.
    if (!chosen || !this.running || this.followers.has(agent.agentCrName)) {
      return;
    }
    this.follow(
      kc,
      namespace,
      { ...agent, podName: chosen.podName },
      chosen.containerName,
      emit,
    );
  }

  /** Open one pod's stream and emit its chunks until it ends or we stop. */
  private follow(
    kc: KubeConfig,
    namespace: string,
    target: PodLogTarget,
    containerName: string,
    emit: Emit,
  ): void {
    let batch: PendingBatch = emptyBatch();
    let seq = 0;
    let carry = "";

    const send = async (lines: string | null): Promise<void> => {
      if (lines !== null) {
        seq++;
        // Awaited so a full queue slows the READER of this stream rather than accumulating unsent chunks here.
        await emit({ kind: "event", event: podLogEvent(target, seq, lines) });
      }
    };

    const sink = new Writable({
      write: (chunk: Buffer, _enc, done) => {
        const text = carry + chunk.toString("utf8");
        const parts = text.split("\n");

        // The last part is whatever arrived without a newline — hold it until the rest of the line does.
        carry = parts.pop() ?? "";

        void (async () => {
          try {
            for (const line of parts) {
              const step = addLine(batch, line, LIMITS);

              batch = step.batch;
              await send(step.flushed);
            }
            done();
          } catch (err) {
            // `done` MUST run on every path — a write callback that never resolves stalls the Writable for good, indistinguishable from a quiet pod.
            done(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      },
    });

    const timer = setInterval(() => {
      const step = drain(batch);

      batch = step.batch;
      // Caught here as on the final flush — an idle flush that rejects is an unhandled rejection this process installs no handler for.
      void send(step.flushed).catch((err) =>
        console.error(
          `[cluster-agent] idle pod-log flush failed for ${target.podName}:`,
          errorMessage(err),
        ),
      );
    }, IDLE_FLUSH_MS);

    const abort = new AbortController();

    // A pod finishing is the ordinary case — without this the idle timer keeps draining a dead batch forever and the follower entry never leaves the map.
    const finish = (why: string) => {
      const step = drainAtEnd(batch, carry);

      carry = "";

      batch = step.batch;
      void send(step.flushed).catch((err) =>
        console.error(
          `[cluster-agent] final pod-log flush failed for ${target.podName} (${why}):`,
          errorMessage(err),
        ),
      );
      clearInterval(timer);
      this.followers.delete(target.agentCrName);
    };

    sink.once("finish", () => finish("stream ended"));
    sink.once("error", (err: Error) =>
      finish(`stream errored: ${err.message}`),
    );

    this.followers.set(target.agentCrName, { abort, timer });

    void new Log(kc)
      .log(namespace, target.podName, containerName, sink, { follow: true })
      .then((controller) => {
        // Honors a stop that landed while the request was still opening — the listener below would never fire for an abort that already happened.
        if (abort.signal.aborted) {
          controller.abort();

          return;
        }
        abort.signal.addEventListener("abort", () => controller.abort());
      })
      .catch((err) => {
        console.error(
          `[cluster-agent] pod-log stream failed for ${target.podName}:`,
          errorMessage(err),
        );
        finish("stream could not be opened");
      });
  }
}
