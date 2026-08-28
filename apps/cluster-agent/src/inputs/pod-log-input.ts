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
import { KubeConfig, CoreV1Api, Log } from "@kubernetes/client-node";
import { agentsNamespace, loadKube } from "@re-cinq/lore-shared";
import type {
  Emit,
  EventInput,
} from "@re-cinq/lore-shared/project/events/event-input-port.js";
import {
  addLine,
  drain,
  emptyBatch,
  followableAgents,
  podLogEvent,
  type BatchLimits,
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
    try {
      const kc = new KubeConfig();

      loadKube(kc);

      const namespace = agentsNamespace();
      const core = kc.makeApiClient(CoreV1Api);
      const agents: unknown[] = [];

      await forEachAgentPage(
        kc.makeApiClient(
          (await import("@kubernetes/client-node")).CustomObjectsApi,
        ),
        namespace,
        async (page) => {
          agents.push(...page);
        },
      );

      for (const agent of followableAgents(
        agents as never[],
        new Set(this.followers.keys()),
      )) {
        const pods = await core.listNamespacedPod({
          namespace,
          labelSelector: podSelectorForJob(agent.jobName),
        });
        const podName = pods.items?.[0]?.metadata?.name;

        if (podName && this.running) {
          this.follow(kc, namespace, { ...agent, podName }, emit);
        }
      }
    } catch (err) {
      console.error(
        "[cluster-agent] pod-log discovery failed:",
        (err as Error).message,
      );
    }
  }

  /** Open one pod's stream and emit its chunks until it ends or we stop. */
  private follow(
    kc: KubeConfig,
    namespace: string,
    target: PodLogTarget,
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
          for (const line of parts) {
            const step = addLine(batch, line, LIMITS);

            batch = step.batch;
            await send(step.flushed);
          }
          done();
        })();
      },
    });

    const timer = setInterval(() => {
      const step = drain(batch);

      batch = step.batch;
      void send(step.flushed);
    }, IDLE_FLUSH_MS);

    const abort = new AbortController();

    this.followers.set(target.agentCrName, { abort, timer });

    void new Log(kc)
      .log(namespace, target.podName, "", sink, { follow: true })
      .then((controller) => {
        // The stream's own controller, so `stop` aborts the live request rather
        // than only the intent to make it.
        abort.signal.addEventListener("abort", () => controller.abort());
      })
      .catch((err) => {
        console.error(
          `[cluster-agent] pod-log stream failed for ${target.podName}:`,
          (err as Error).message,
        );
        clearInterval(timer);
        this.followers.delete(target.agentCrName);
      });
  }
}
