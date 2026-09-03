import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.pod_log_chunks` — a span of one run pod's stdout, kept so logs outlive the pod; no FKs (skip-not-fail ingest, per 0031); `id` is a string-encoded bigint like `agent_run_events.id`; `(podName, seq)` is unique so a redelivered batch collapses rather than duplicates. */
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
