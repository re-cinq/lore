/** The Floor-side binding for `kubernetes.pod_log.appended`. Thin on purpose: the decision (well-formed vs. dropped) lives in `pod-log-ingest.ts`, tested against the in-memory store; this only supplies the pool-backed one. */

import type { EventHandler } from "../../domain/event-types.js";
import { pipeline } from "../../outbound/queues.js";
import { ingestPodLogChunks } from "./pod-log-ingest.js";

export const podLogAppended: EventHandler = (params) =>
  ingestPodLogChunks(params, pipeline().podLogs);
