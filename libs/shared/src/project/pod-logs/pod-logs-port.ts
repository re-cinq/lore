/** `pipeline.pod_log_chunks` — the durable half of a run pod's stdout; the only log source that works for a satellite-claimed run. Deliberately NOT the same store as `agent_run_events` (that's the AGENT's projected transcript; this is raw container stdout from every node type). */

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
  /** Append a batch, idempotent on `(podName, seq)` — a redelivered batch (producer retries through the event proxy) must collapse rather than duplicate. */
  appendBatch(chunks: PodLogChunkInsert[]): Promise<void>;

  /** Every chunk for a Job, in the order its pod emitted them. */
  listForJob(jobName: string): Promise<PodLogChunk[]>;

  /** Retention reap. Returns how many rows went. */
  pruneOld(olderThanDays: number): Promise<number>;
}
