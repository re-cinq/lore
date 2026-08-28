/**
 * `kubernetes.pod_log.appended` — persist a span of a run pod's stdout.
 *
 * The producer is the cluster-agent's pod-log input, which follows a running
 * pod and emits batches through its event proxy. The point of persisting them
 * is reach, not storage: live pod logs come from the Kubernetes API of ONE
 * cluster and the Cloud Logging fallback names ONE project, so a run claimed by
 * a satellite has no log path at all. A chunk that got here came over the bus,
 * which every cluster can do.
 *
 * SKIP-NOT-FAIL on a malformed event, like every other ingest path here: a
 * handler that throws sends the delivery round the retry ladder to a dead
 * letter, and a malformed event is just as malformed on the fifth attempt.
 */

import type { PodLogChunkInsert } from "@re-cinq/lore-shared/project/pod-logs/pod-logs-port.js";
import type { PodLogsRepository } from "@re-cinq/lore-shared/project/pod-logs/pod-logs-port.js";

const asText = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Read an event's params into storable chunks, dropping what cannot be keyed. */
export function parsePodLogAppended(params: unknown): PodLogChunkInsert[] {
  const event = (params ?? {}) as Record<string, unknown>;
  const agentCrName = asText(event.agentCrName);
  const jobName = asText(event.jobName);
  const podName = asText(event.podName);

  // All three identify the chunk: without them a stored span cannot be found
  // again, which is the only reason to store it.
  if (!agentCrName || !jobName || !podName) {
    return [];
  }
  const chunks = Array.isArray(event.chunks) ? event.chunks : [];

  return chunks
    .map((chunk) => (chunk ?? {}) as Record<string, unknown>)
    .filter(
      (chunk) =>
        typeof chunk.seq === "number" && typeof chunk.lines === "string",
    )
    .map((chunk) => ({
      agentCrName,
      jobName,
      podName,
      seq: chunk.seq as number,
      lines: chunk.lines as string,
    }));
}

export async function ingestPodLogChunks(
  params: unknown,
  store: PodLogsRepository,
): Promise<void> {
  await store.appendBatch(parsePodLogAppended(params));
}
