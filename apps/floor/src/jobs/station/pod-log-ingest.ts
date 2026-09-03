/** Persist pod log chunks for cross-cluster reach; SKIP-NOT-FAIL on malformed events. */

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

  // All three fields are required to find a stored chunk
  if (!agentCrName || !jobName || !podName) {
    return [];
  }
  const chunks = Array.isArray(event.chunks) ? event.chunks : [];

  return (
    chunks
      .map((chunk) => (chunk ?? {}) as Record<string, unknown>)
      // Drop malformed chunks (invalid seq or non-string lines); batch unnesting needs int[]
      .filter(
        (chunk) =>
          Number.isInteger(chunk.seq) && typeof chunk.lines === "string",
      )
      .map((chunk) => ({
        agentCrName,
        jobName,
        podName,
        seq: chunk.seq as number,
        lines: chunk.lines as string,
      }))
  );
}

export async function ingestPodLogChunks(
  params: unknown,
  store: PodLogsRepository,
): Promise<void> {
  await store.appendBatch(parsePodLogAppended(params));
}
