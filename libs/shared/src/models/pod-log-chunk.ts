import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `pipeline.pod_log_chunks` — a span of one run pod's stdout, kept so a node's
 * logs outlive the pod and are readable for a run executed in a cluster the
 * Floor cannot reach.
 *
 * DDL: migration `0052_pod_log_chunks.sql`. No foreign keys, deliberately —
 * ingest is a skip-not-fail batch insert, and one unknown id under an FK drops
 * the whole batch (the reason 0031 gives).
 *
 * `id` is a string-encoded bigint, for the same reason `agent_run_events.id`
 * is: it outgrows `Number.MAX_SAFE_INTEGER` and is never a JS number.
 *
 * `seq` is assigned per POD by the producer, so reassembly restores the order
 * the pod emitted in. `(podName, seq)` is unique: the producer retries through
 * the event proxy, so a redelivered batch is expected and must collapse rather
 * than duplicate a span of log.
 */
export const PodLogChunkSchema = z.object({
  id: z.string(),
  agentCrName: z.string(),
  jobName: z.string(),
  podName: z.string(),
  seq: z.number(),
  lines: z.string(),
  createdAt: z.date(),
});

export type PodLogChunk = z.infer<typeof PodLogChunkSchema>;

export const POD_LOG_CHUNK_COLUMNS = {
  id: "id",
  agentCrName: "agent_cr_name",
  jobName: "job_name",
  podName: "pod_name",
  seq: "seq",
  lines: "lines",
  createdAt: "created_at",
} as const satisfies ColumnMap<PodLogChunk>;

export const POD_LOG_CHUNK_TABLE = "pipeline.pod_log_chunks";
