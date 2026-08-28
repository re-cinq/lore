/**
 * `pipeline.pod_log_chunks` — the durable half of a run pod's stdout.
 *
 * Live pod logs are read straight from the Kubernetes API and vanish with the
 * pod; the Cloud Logging fallback behind them names the central project. Both
 * are central-only, so a run claimed by a satellite has no log path at all,
 * live or archived. These chunks are the third source and the only one that
 * works for a cluster reporting inward.
 *
 * Deliberately NOT the same store as `agent_run_events`. That is the projected
 * stream-json transcript of an AGENT; this is raw container stdout, which every
 * node type produces including the station pods that run no model at all.
 */

import type { PodLogChunk } from "../../models/pod-log-chunk.js";

/** One span of stdout, as the producer observed it. */
export interface PodLogChunkInsert {
  agentCrName: string;
  jobName: string;
  podName: string;
  /** Per-pod, monotonic. Reassembly orders by it; redelivery collapses on it. */
  seq: number;
  lines: string;
}

export interface PodLogsRepository {
  /**
   * Append a batch. Idempotent on `(podName, seq)`: the producer retries
   * through the event proxy, so a redelivered batch must collapse rather than
   * duplicate a span of log.
   */
  appendBatch(chunks: PodLogChunkInsert[]): Promise<void>;

  /** Every chunk for a Job, in the order its pod emitted them. */
  listForJob(jobName: string): Promise<PodLogChunk[]>;

  /** Retention reap. Returns how many rows went. */
  pruneOld(olderThanDays: number): Promise<number>;
}
