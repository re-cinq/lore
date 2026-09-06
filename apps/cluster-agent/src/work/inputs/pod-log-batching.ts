// Pure decision half of how a followed pod's stdout becomes bus events — batches by lines/bytes, one event per chunk with a dedupe key, to keep log volume honest on pipeline.events (a fan-out queue, not bulk data).

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

/** Take one line, say whether that completes a chunk. The line is always ADDED before limits are checked, so an oversized line flushes on its own rather than wedging the batch. */
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

/** Flush whatever is held — the idle timer and end-of-stream both land here, so a quiet pod does not strand its last lines. */
export function drain(batch: PendingBatch): BatchStep {
  if (batch.lines.length === 0) {
    return { batch, flushed: null };
  }

  return { batch: emptyBatch(), flushed: render(batch) };
}

/** The last flush of an ended stream: the batch plus the fragment held back for want of a newline — a pod dying mid-write loses exactly that fragment otherwise. */
export function drainAtEnd(batch: PendingBatch, carry: string): BatchStep {
  if (!carry) {
    return drain(batch);
  }

  return drain({
    lines: [...batch.lines, carry],
    bytes: batch.bytes + Buffer.byteLength(carry) + 1,
  });
}

/** One chunk as its event, keyed on POD and sequence (never the job) — both pods of a retried node start at seq 1, so job-keyed dedupe would drop the retry's first chunk. */
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

/** Same choice as {@link followableAgents}, reduced to names — discovery must never hold a page of Agent CRs (130 accumulated ones OOM-killed a satellite cluster-agent for 21h). */
export function followTargets(
  agents: readonly FollowableAgent[],
  following: ReadonlySet<string>,
): Array<{ agentCrName: string; jobName: string }> {
  return followableAgents(agents, following).map(
    ({ agentCrName, jobName }) => ({ agentCrName, jobName }),
  );
}

/** Which agents this tick should open a log stream for — skips terminal ones, ones with no Job yet, and already-followed ones (else each stream reassigns seqs and dedupe cannot collapse the duplicates). */
function orEmpty(value: string | undefined): string {
  return value ?? "";
}

export function followableAgents(
  agents: readonly FollowableAgent[],
  following: ReadonlySet<string>,
): Array<{ agentCrName: string; jobName: string }> {
  return agents
    .map((agent) => ({
      agentCrName: orEmpty(agent.metadata?.name),
      jobName: orEmpty(agent.status?.jobName),
      phase: orEmpty(agent.status?.phase),
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
  /** `creationTimestamp` is a Date on the real `V1Pod`, a string on the wire — both accepted since both turn up. */
  metadata?: { name?: string; creationTimestamp?: string | Date };
  spec?: { containers?: Array<{ name?: string }> };
}

/** Sortable form of a creation timestamp, whichever shape it arrived in. */
function createdAt(pod: FollowablePod): string {
  const raw = pod.metadata?.creationTimestamp;

  return raw instanceof Date ? raw.toISOString() : (raw ?? "");
}

function newestPodName(pod: FollowablePod | undefined): string | undefined {
  return pod?.metadata?.name;
}

function firstContainerName(
  pod: FollowablePod | undefined,
): string | undefined {
  return pod?.spec?.containers?.[0]?.name;
}

/** Which pod to stream, and WHICH CONTAINER — the container is not optional (`Log.log(ns, pod, "", …)` 400s); the FIRST container is the workload, anything after it a sidecar. */
export function pickPodToFollow(
  pods: readonly FollowablePod[],
): { podName: string; containerName: string } | null {
  const newest = [...pods].sort((a, b) =>
    createdAt(b).localeCompare(createdAt(a)),
  )[0];
  const podName = newestPodName(newest);
  const containerName = firstContainerName(newest);

  if (!podName || !containerName) {
    return null;
  }

  return { podName, containerName };
}
