/**
 * Floor-side singletons for the shared ArchivePort adapters (GCS blob
 * archival), mirroring the queues.ts lazy-singleton pattern: buckets come from
 * env at first use, jobs default their injected dependency to these so tests
 * swap in the shared InMemoryArchive double.
 */
import { GcsArchive } from "@re-cinq/lore-shared/project/archive/archive-gcs.js";
import { FileArchive } from "@re-cinq/lore-shared/project/archive/archive-file.js";
import type { ArchivePort } from "@re-cinq/lore-shared/project/archive/archive-port.js";

let agentEventsSingleton: ArchivePort | null | undefined;
let jobRunLogsSingleton: ArchivePort | undefined;

/**
 * Raw agent-event NDJSON streams (#687) and agent conversation archives.
 *
 * A bucket wins. `LORE_ARCHIVE_DIR` is the single-machine fallback, and it is
 * OPT-IN rather than a default: a cluster that lost its bucket config would
 * otherwise start writing conversations to pod-local disk that vanishes with the
 * pod, which looks like continuity right up until it isn't. Neither set stays a
 * dormant no-op, as before.
 */
export function agentEventsArchive(): ArchivePort | null {
  if (agentEventsSingleton === undefined) {
    const bucket = process.env.LORE_AGENT_EVENTS_BUCKET;
    const dir = process.env.LORE_ARCHIVE_DIR;

    agentEventsSingleton = bucket
      ? new GcsArchive(bucket)
      : dir
        ? new FileArchive(dir)
        : null;
  }

  return agentEventsSingleton;
}

/** Scheduler job-run logs (redacted before save, CMEK-encrypted at rest). */
export function jobRunLogArchive(): ArchivePort {
  return (jobRunLogsSingleton ??= new GcsArchive(
    process.env.LORE_LOG_BUCKET || "lore-task-logs",
  ));
}
