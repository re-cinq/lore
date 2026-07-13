/**
 * Floor-side singletons for the shared ArchivePort adapters (GCS blob
 * archival), mirroring the queues.ts lazy-singleton pattern: buckets come from
 * env at first use, jobs default their injected dependency to these so tests
 * swap in the shared InMemoryArchive double.
 */
import { GcsArchive } from "@re-cinq/lore-shared/project/archive/archive-gcs.js";
import type { ArchivePort } from "@re-cinq/lore-shared/project/archive/archive-port.js";

let agentEventsSingleton: ArchivePort | null | undefined;
let jobRunLogsSingleton: ArchivePort | undefined;

/**
 * Raw agent-event NDJSON streams (#687). Null while LORE_AGENT_EVENTS_BUCKET
 * is unset — the archive stays a dormant no-op until ops provision a bucket.
 */
export function agentEventsArchive(): ArchivePort | null {
  if (agentEventsSingleton === undefined) {
    const bucket = process.env.LORE_AGENT_EVENTS_BUCKET;

    agentEventsSingleton = bucket ? new GcsArchive(bucket) : null;
  }

  return agentEventsSingleton;
}

/** Scheduler job-run logs (redacted before save, CMEK-encrypted at rest). */
export function jobRunLogArchive(): ArchivePort {
  return (jobRunLogsSingleton ??= new GcsArchive(
    process.env.LORE_LOG_BUCKET || "lore-task-logs",
  ));
}
