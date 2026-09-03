/** Floor-side singletons for the shared ArchivePort adapters (GCS blob archival), mirroring the queues.ts lazy-singleton pattern — buckets resolve from env at first use, jobs default to these so tests swap in the shared InMemoryArchive double. */
import { GcsArchive } from "@re-cinq/lore-shared/project/archive/archive-gcs.js";
import { FileArchive } from "@re-cinq/lore-shared/project/archive/archive-file.js";
import type { ArchivePort } from "@re-cinq/lore-shared/project/archive/archive-port.js";

let conversationSingleton: ArchivePort | null | undefined;
let jobRunLogsSingleton: ArchivePort | undefined;

/** Agent CONVERSATION archives — the tarball a run saves to resume later (ai-agent-subsystem#188). The env var keeps its old NDJSON-era name (renaming would silently un-configure deployed buckets); `LORE_ARCHIVE_DIR` is an OPT-IN single-machine fallback, never a default, so a cluster that lost its bucket config fails loud instead of writing to vanishing pod-local disk. */
export function conversationArchive(): ArchivePort | null {
  if (conversationSingleton === undefined) {
    conversationSingleton = resolveConversationArchive(
      process.env.LORE_AGENT_EVENTS_BUCKET,
      process.env.LORE_ARCHIVE_DIR,
    );
  }

  return conversationSingleton;
}

function resolveConversationArchive(
  bucket: string | undefined,
  dir: string | undefined,
): ArchivePort | null {
  if (bucket) {
    return new GcsArchive(bucket);
  }

  if (dir) {
    return new FileArchive(dir);
  }

  return null;
}

/** Scheduler job-run logs (redacted before save, CMEK-encrypted at rest). */
export function jobRunLogArchive(): ArchivePort {
  return (jobRunLogsSingleton ??= new GcsArchive(
    process.env.LORE_LOG_BUCKET || "lore-task-logs",
  ));
}
