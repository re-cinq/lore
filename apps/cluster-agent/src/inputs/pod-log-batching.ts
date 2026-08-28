/**
 * How a followed pod's stdout becomes bus events: the decision half, pure.
 *
 * This is the piece that decides how much log volume reaches `pipeline.events`,
 * which is a dispatch queue built for handler fan-out and dedupe rather than for
 * bulk data. Every limit here exists to keep that honest — batch by lines, cap
 * by bytes, one event per chunk with a dedupe key — and it is all testable
 * without a cluster, because getting it wrong is an operational problem rather
 * than a crash.
 */

import type { EventInsert } from "@re-cinq/lore-shared";

export interface BatchLimits {
  /** Flush once this many lines are held. */
  maxLines: number;
  /** Flush once the held lines reach this many bytes, whichever comes first. */
  maxBytes: number;
}

export interface PendingBatch {
  lines: string[];
  bytes: number;
}

export interface BatchStep {
  batch: PendingBatch;
  /** The chunk to emit, or null while the batch is still filling. */
  flushed: string | null;
}

/** Which pod a chunk came from — the identity the stored chunk is keyed by. */
export interface PodLogTarget {
  agentCrName: string;
  jobName: string;
  podName: string;
}

export function emptyBatch(): PendingBatch {
  return { lines: [], bytes: 0 };
}

/** The wire form: newline-terminated, so chunks concatenate back into a log. */
function render(batch: PendingBatch): string {
  return batch.lines.map((line) => `${line}\n`).join("");
}

/**
 * Take one line, and say whether that completes a chunk.
 *
 * The line is always ADDED before the limits are checked, so a single line
 * longer than `maxBytes` flushes on its own rather than wedging a batch that
 * can never satisfy its own limit. The cap bounds this process's memory; it
 * cannot bound what the pod chose to write.
 */
export function addLine(
  batch: PendingBatch,
  line: string,
  limits: BatchLimits,
): BatchStep {
  const grown: PendingBatch = {
    lines: [...batch.lines, line],
    bytes: batch.bytes + Buffer.byteLength(line) + 1,
  };

  if (grown.lines.length >= limits.maxLines || grown.bytes >= limits.maxBytes) {
    return { batch: emptyBatch(), flushed: render(grown) };
  }

  return { batch: grown, flushed: null };
}

/** Flush whatever is held — the idle timer and end-of-stream both land here, so
 *  a pod that goes quiet mid-batch does not strand its last lines. */
export function drain(batch: PendingBatch): BatchStep {
  if (batch.lines.length === 0) {
    return { batch, flushed: null };
  }

  return { batch: emptyBatch(), flushed: render(batch) };
}

/**
 * One chunk as its event.
 *
 * Keyed on the POD and the sequence, never the job: both pods of a retried node
 * start at seq 1, and a job-keyed dedupe would silently drop the retry's first
 * chunk as a duplicate of the original's — the same trap the stored table's
 * unique index avoids.
 */
export function podLogEvent(
  target: PodLogTarget,
  seq: number,
  lines: string,
): EventInsert {
  return {
    eventName: "kubernetes.pod_log.appended",
    source: "kubernetes",
    params: { ...target, chunks: [{ seq, lines }] },
    dedupeKey: `k8s:podlog:${target.podName}:${seq}`,
  };
}

/** The slice of an Agent CR this decision reads. */
export interface FollowableAgent {
  metadata?: { name?: string };
  status?: { phase?: string; jobName?: string };
}

const TERMINAL_PHASES = new Set(["Succeeded", "Failed"]);

/**
 * Which agents this tick should open a log stream for.
 *
 * Skips the terminal ones (their output is already in the stored chunks, and
 * the pod is on its way out), the ones with no Job yet (nothing to open a
 * stream against), and — the one that matters — the ones already being
 * followed. Discovery re-runs on a timer over the same running agents, so
 * without that last check every tick opens another stream on the same pod and
 * emits each line once per stream. Dedupe is per `(pod, seq)` and each stream
 * assigns its own seqs, so those duplicates would NOT collapse.
 */
export function followableAgents(
  agents: readonly FollowableAgent[],
  following: ReadonlySet<string>,
): Array<{ agentCrName: string; jobName: string }> {
  return agents
    .map((agent) => ({
      agentCrName: agent.metadata?.name ?? "",
      jobName: agent.status?.jobName ?? "",
      phase: agent.status?.phase ?? "",
    }))
    .filter(
      (agent) =>
        Boolean(agent.agentCrName) &&
        Boolean(agent.jobName) &&
        !TERMINAL_PHASES.has(agent.phase),
    )
    .filter((agent) => !following.has(agent.agentCrName))
    .map(({ agentCrName, jobName }) => ({ agentCrName, jobName }));
}

/** The slice of a Pod this decision reads. */
export interface FollowablePod {
  /** `creationTimestamp` is a Date on the real `V1Pod` and a string on the
   *  wire. Both are accepted because both turn up: the client's model mapper
   *  parses it, and a hand-built fixture usually does not. */
  metadata?: { name?: string; creationTimestamp?: string | Date };
  spec?: { containers?: Array<{ name?: string }> };
}

/** Sortable form of a creation timestamp, whichever shape it arrived in. */
function createdAt(pod: FollowablePod): string {
  const raw = pod.metadata?.creationTimestamp;

  return raw instanceof Date ? raw.toISOString() : (raw ?? "");
}

/**
 * Which pod to stream, and WHICH CONTAINER of it.
 *
 * The container is not optional. `Log.log(ns, pod, "", …)` sends an empty
 * `?container=` and the apiserver answers `400 Error occurred in log request` —
 * found the hard way on the first pilot run, where every discovery tick opened
 * a stream and got a 400 back. An agent pod has two containers (`init` and
 * `agent`), so there is no implicit choice for the API to make.
 *
 * The FIRST container is the workload; anything after it is a sidecar. Reading
 * it off the pod rather than hardcoding "agent" keeps this correct for a
 * station pod, a custom image, or whatever the subsystem names it next.
 */
export function pickPodToFollow(
  pods: readonly FollowablePod[],
): { podName: string; containerName: string } | null {
  const newest = [...pods].sort((a, b) =>
    createdAt(b).localeCompare(createdAt(a)),
  )[0];
  const podName = newest?.metadata?.name;
  const containerName = newest?.spec?.containers?.[0]?.name;

  if (!podName || !containerName) {
    return null;
  }

  return { podName, containerName };
}
