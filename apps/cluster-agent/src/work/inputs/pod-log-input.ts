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
import { forEachAgentPage } from "../../outbound/agent-pages.js";
import { podSelectorForJob } from "../../outbound/kube-pod-logs.js";
import {
  coreApi,
  customObjectsApi,
  kubeConfig,
} from "../../outbound/kube-clients.js";

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

/** The cluster connection and namespace one stream is opened against. */
interface NamespaceHandle {
  kc: KubeConfig;
  namespace: string;
}

/** Accumulates a pod's log stream into batches. Owns the three pieces of state the stream, the idle timer and the finish path all touch — the pending batch, the sequence number, and the partial line held back until its newline arrives. */
class PodLogBatcher {
  private batch: PendingBatch = emptyBatch();
  private seq = 0;
  private carry = "";

  constructor(
    private readonly target: PodLogTarget,
    private readonly emit: Emit,
  ) {}

  private async send(lines: string | null): Promise<void> {
    if (lines !== null) {
      this.seq++;
      // Awaited so a full queue slows the READER of this stream rather than accumulating unsent chunks here.
      await this.emit({
        kind: "event",
        event: podLogEvent(this.target, this.seq, lines),
      });
    }
  }

  /** Flushes that cannot be awaited are logged rather than left to reject — this process installs no unhandled-rejection handler. */
  private sendDetached(lines: string | null, why: string): void {
    void this.send(lines).catch((err) =>
      console.error(
        `[cluster-agent] pod-log flush failed for ${this.target.podName} (${why}):`,
        errorMessage(err),
      ),
    );
  }

  async consume(chunk: string): Promise<void> {
    const parts = (this.carry + chunk).split("\n");

    // The last part is whatever arrived without a newline — hold it until the rest of the line does.
    this.carry = parts.pop() ?? "";

    for (const line of parts) {
      const step = addLine(this.batch, line, LIMITS);

      this.batch = step.batch;
      await this.send(step.flushed);
    }
  }

  flushIdle(): void {
    const step = drain(this.batch);

    this.batch = step.batch;
    this.sendDetached(step.flushed, "idle");
  }

  flushFinal(why: string): void {
    const step = drainAtEnd(this.batch, this.carry);

    this.carry = "";
    this.batch = step.batch;
    this.sendDetached(step.flushed, why);
  }
}

/** A Writable that hands each chunk to the batcher. `done` MUST run on every path — a write callback that never resolves stalls the Writable for good, which is indistinguishable from a quiet pod. */
function batchingSink(batcher: PodLogBatcher): Writable {
  return new Writable({
    write: (chunk: Buffer, _enc, done) => {
      void (async () => {
        try {
          await batcher.consume(chunk.toString("utf8"));
          done();
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    },
  });
}

// The pod to stream, and the container within it. The CONTAINER is resolved here too rather than defaulted — an empty container name 400s the log request.
async function podToFollow(
  core: CoreV1Api,
  namespace: string,
  jobName: string,
) {
  const pods = await core.listNamespacedPod({
    namespace,
    labelSelector: podSelectorForJob(jobName),
  });

  return pickPodToFollow(pods.items);
}

// Both ways a sink stops — a clean end and an error — reach the same finisher, because a follower left in the map is a leak either way.
function endsWith(sink: Writable, finish: (why: string) => void): void {
  sink.once("finish", () => finish("stream ended"));
  sink.once("error", (err: Error) => finish(`stream errored: ${err.message}`));
}

/** Opens the stream and wires the abort. A stop that landed while the request was still opening is honoured explicitly — the listener alone would never fire for an abort that already happened. */
function attachStream(
  { kc, namespace }: NamespaceHandle,
  target: PodLogTarget,
  containerName: string,
  wiring: {
    sink: Writable;
    abort: AbortController;
    finish: (why: string) => void;
  },
): void {
  const { sink, abort, finish } = wiring;

  void new Log(kc)
    .log(namespace, target.podName, containerName, sink, { follow: true })
    .then((controller) => bindAbort(controller, abort))
    .catch((err: unknown) => {
      reportOpenFailure(target.podName, err);
      finish("stream could not be opened");
    });
}

// The stream never opened. Logged rather than thrown: discovery runs over every agent, and one unreadable pod must not stop the others being followed.
function reportOpenFailure(podName: string, err: unknown): void {
  console.error(
    `[cluster-agent] pod-log stream failed for ${podName}:`,
    errorMessage(err),
  );
}

// Honours a stop that landed while the request was still opening. The listener alone would never fire for an abort that already happened, leaving the stream running with nobody to stop it.
function bindAbort(
  controller: { abort: () => void },
  abort: AbortController,
): void {
  if (abort.signal.aborted) {
    controller.abort();

    return;
  }
  abort.signal.addEventListener("abort", () => controller.abort());
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

  // Opens a stream for every running agent not already followed. Page by page, holding NOTHING between them — accumulating the namespace into one array OOM-killed a satellite's cluster-agent for 21h and stranded its Agent-CR watch.
  private async followAllRunning(emit: Emit): Promise<void> {
    const kc = kubeConfig();
    const namespace = agentsNamespace();
    const core = coreApi();

    await forEachAgentPage(customObjectsApi(), namespace, async (page) => {
      for (const agent of followTargets(
        page as FollowableAgent[],
        new Set(this.followers.keys()),
      )) {
        await this.followOne({ kc, namespace }, core, agent, emit);
      }
    });
  }

  /** One discovery pass: open a stream for every running agent not already followed. Failures are logged, never thrown. */
  private async discover(emit: Emit): Promise<void> {
    if (this.discovering) {
      return;
    }
    this.discovering = true;

    try {
      await this.followAllRunning(emit);
    } catch (err) {
      console.error(
        "[cluster-agent] pod-log discovery failed:",
        errorMessage(err),
      );
    } finally {
      this.discovering = false;
    }
  }

  // Whether this agent should still be followed. Re-checked against the LIVE map, not the filtered page: a pod list was awaited since then, and stop() may have run too.
  private stillWanted(agentCrName: string): boolean {
    return this.running && !this.followers.has(agentCrName);
  }

  /** Find the pod for one agent and open its stream. */
  private async followOne(
    cluster: NamespaceHandle,
    core: CoreV1Api,
    agent: { agentCrName: string; jobName: string },
    emit: Emit,
  ): Promise<void> {
    const chosen = await podToFollow(core, cluster.namespace, agent.jobName);

    if (!chosen || this.stillWanted(agent.agentCrName) === false) {
      return;
    }
    this.follow(
      cluster,
      { ...agent, podName: chosen.podName },
      chosen.containerName,
      emit,
    );
  }

  // Closes out one follower. A pod finishing is the ORDINARY case — without this the idle timer keeps draining a dead batch forever and the follower entry never leaves the map.
  private finisher(
    target: PodLogTarget,
    batcher: PodLogBatcher,
    timer: ReturnType<typeof setInterval>,
  ): (why: string) => void {
    return (why: string) => {
      batcher.flushFinal(why);
      clearInterval(timer);
      this.followers.delete(target.agentCrName);
    };
  }

  /** Open one pod's stream and emit its chunks until it ends or we stop. */
  private follow(
    { kc, namespace }: NamespaceHandle,
    target: PodLogTarget,
    containerName: string,
    emit: Emit,
  ): void {
    const batcher = new PodLogBatcher(target, emit);
    const sink = batchingSink(batcher);
    const timer = setInterval(() => batcher.flushIdle(), IDLE_FLUSH_MS);
    const abort = new AbortController();
    const finish = this.finisher(target, batcher, timer);

    endsWith(sink, finish);
    this.followers.set(target.agentCrName, { abort, timer });

    attachStream({ kc, namespace }, target, containerName, {
      sink,
      abort,
      finish,
    });
  }
}
