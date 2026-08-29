/**
 * `PodLogInput` — follow this cluster's running pods and emit their stdout.
 *
 * The CONNECTION half, like the Agent-CR watch next door: discovery on a timer,
 * one long-lived log stream per pod, an AbortController per stream. Every
 * decision it makes — how much to batch, which agents to follow, what the event
 * looks like — lives in `pod-log-batching.ts` and is tested without a cluster.
 *
 * WHY this exists: pod logs are read live from ONE cluster's Kubernetes API,
 * with a Cloud Logging fallback naming ONE project. A run claimed by a satellite
 * is invisible to both. Emitting the log as it happens is the only way a cluster
 * that reports inward can be read from the centre.
 *
 * OFF BY DEFAULT (`LORE_POD_LOG_STREAMING=1`). This is the piece that puts log
 * volume on `pipeline.events`, a dispatch queue built for handler fan-out rather
 * than bulk data. The limits below are the mitigation, a pilot repo is the
 * validation, and the flag is what makes both possible.
 */

import { Writable } from "node:stream";
import {
  KubeConfig,
  CoreV1Api,
  CustomObjectsApi,
  Log,
} from "@kubernetes/client-node";
import { agentsNamespace, errorMessage, loadKube } from "@re-cinq/lore-shared";
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

/** Deliberately small: this bounds what one chunk costs the bus, not what the
 *  pod may write. A single line past the byte cap still flushes on its own. */
const LIMITS: BatchLimits = { maxLines: 200, maxBytes: 64 * 1024 };
const DISCOVERY_INTERVAL_MS = 15_000;
/** Flush a partial batch after this long, so a quiet pod's last lines are not
 *  stranded until it produces enough to fill a chunk. */
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
  /** One discovery pass at a time. A pass that outlives the interval — a big
   *  namespace, a slow apiserver — would otherwise overlap its successor, and
   *  both would see the same agent as unfollowed and open a stream on it. Each
   *  stream numbers its own chunks, and dedupe is per `(pod, seq)`, so those
   *  duplicates do NOT collapse: every line lands twice. */
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

  /** One discovery pass: open a stream for every running agent not already
   *  followed. Failures are logged, never thrown — a pod that cannot be opened
   *  must not stop the ones that can. */
  private async discover(emit: Emit): Promise<void> {
    if (this.discovering) {
      return;
    }
    this.discovering = true;

    try {
      const kc = new KubeConfig();

      loadKube(kc);

      const namespace = agentsNamespace();
      const core = kc.makeApiClient(CoreV1Api);

      // Page by page, holding NOTHING between them. Every Agent CR carries its
      // run's whole transcript in `status.output`, so accumulating the namespace
      // into one array — which is what this did — is hundreds of megabytes
      // against a 256Mi limit. It OOM-killed a satellite's cluster-agent every
      // seven seconds for twenty-one hours, taking down the Agent-CR watch with
      // it and stranding every finished run in that cluster.
      await forEachAgentPage(
        kc.makeApiClient(CustomObjectsApi),
        namespace,
        async (page) => {
          for (const agent of followTargets(
            page as FollowableAgent[],
            new Set(this.followers.keys()),
          )) {
            await this.followOne(kc, namespace, core, agent, emit);
          }
        },
      );
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
    // The CONTAINER is resolved here too, not defaulted: an empty container name
    // makes the log request a 400, which is how the first pilot run spent
    // fifteen minutes retrying and streaming nothing.
    const chosen = pickPodToFollow(pods.items ?? []);

    // Re-checked against the LIVE map rather than the page this was filtered
    // from: a pod list was awaited since then, and `stop()` may have run too.
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
        // Awaited: a full queue must slow the READER of this stream rather than
        // accumulate unsent chunks here, which is the whole point of the bound.
        await emit({ kind: "event", event: podLogEvent(target, seq, lines) });
      }
    };

    const sink = new Writable({
      write: (chunk: Buffer, _enc, done) => {
        const text = carry + chunk.toString("utf8");
        const parts = text.split("\n");

        // The last part is whatever arrived without a newline — hold it until
        // the rest of the line does, or a chunk boundary would split a line.
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
            // `done` MUST run on every path. A write callback that never
            // resolves stalls the Writable for good, so a single failed emit
            // would wedge this pod's stream with no error and no end — the
            // stream would simply stop, indistinguishable from a quiet pod.
            done(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      },
    });

    const timer = setInterval(() => {
      const step = drain(batch);

      batch = step.batch;
      // Caught here as it is on the final flush: an idle flush that rejects is
      // an unhandled rejection, and this process installs no handler for one.
      void send(step.flushed).catch((err) =>
        console.error(
          `[cluster-agent] idle pod-log flush failed for ${target.podName}:`,
          errorMessage(err),
        ),
      );
    }, IDLE_FLUSH_MS);

    const abort = new AbortController();

    // A pod that finishes is the ordinary case, not an edge one: the stream
    // ends, and without this the idle timer keeps draining a dead batch forever
    // and the follower entry never leaves the map. The final drain matters as
    // much as the cleanup — a pod whose last lines did not fill a chunk would
    // otherwise lose them, which is exactly the output of a crashed run.
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
        // The stream's own controller, so `stop` aborts the live request rather
        // than only the intent to make it. A stop that landed while the request
        // was still opening is honoured here — the listener below would never
        // fire for an abort that already happened, leaving the stream running
        // with nothing left to close it.
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
