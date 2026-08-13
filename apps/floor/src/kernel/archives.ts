/**
 * Floor-side singletons for the shared ArchivePort adapters (GCS blob
 * archival), mirroring the queues.ts lazy-singleton pattern: buckets come from
 * env at first use, jobs default their injected dependency to these so tests
 * swap in the shared InMemoryArchive double.
 */
import { GcsArchive } from "@re-cinq/lore-shared/project/archive/archive-gcs.js";
import { FileArchive } from "@re-cinq/lore-shared/project/archive/archive-file.js";
import type { ArchivePort } from "@re-cinq/lore-shared/project/archive/archive-port.js";

let conversationSingleton: ArchivePort | null | undefined;
let jobRunLogsSingleton: ArchivePort | undefined;

/**
 * Agent CONVERSATION archives — the tarball a run saves so a later run can resume
 * it (ai-agent-subsystem#188).
 *
 * This singleton used to serve the raw agent-event NDJSON streams too; #1149 retired
 * that archive in favour of `agent_run_turns`, leaving conversations as the only
 * consumer. The env var keeps its old name because it is deployment config that
 * cluster values already set — renaming it would silently un-configure the bucket.
 *
 * A bucket wins. `LORE_ARCHIVE_DIR` is the single-machine fallback, and it is OPT-IN
 * rather than a default: a cluster that lost its bucket config would otherwise start
 * writing conversations to pod-local disk that vanishes with the pod, which looks
 * like continuity right up until it isn't.
 */
export function conversationArchive(): ArchivePort | null {
  if (conversationSingleton === undefined) {
    const bucket = process.env.LORE_AGENT_EVENTS_BUCKET;
    const dir = process.env.LORE_ARCHIVE_DIR;

    conversationSingleton = bucket
      ? new GcsArchive(bucket)
      : dir
        ? new FileArchive(dir)
        : null;
  }

  return conversationSingleton;
}

/** Scheduler job-run logs (redacted before save, CMEK-encrypted at rest). */
export function jobRunLogArchive(): ArchivePort {
  return (jobRunLogsSingleton ??= new GcsArchive(
    process.env.LORE_LOG_BUCKET || "lore-task-logs",
  ));
}
