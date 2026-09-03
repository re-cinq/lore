// Persistent job-run log storage through the shared ArchivePort (GCS-backed), redacted before writing and encrypted at rest via CMEK; the per-task log helpers were removed for having no callers — only the scheduler's job-run logs live here.

import { redactSecrets } from "@re-cinq/lore-shared";
import type { ArchivePort } from "@re-cinq/lore-shared/project/archive/archive-port.js";
import { jobRunLogArchive } from "../../kernel/archives.js";

export function jobRunLogKey(jobName: string, runId: string): string {
  return `__job_runs__/${jobName}/${runId}/output.log`;
}

export async function writeJobRunLogs(
  jobName: string,
  runId: string,
  rawLogs: string,
  archive: ArchivePort = jobRunLogArchive(),
): Promise<void> {
  await archive.save(jobRunLogKey(jobName, runId), redactSecrets(rawLogs), {
    contentType: "text/plain",
    cacheControl: "no-cache",
  });
}

export async function readJobRunLogs(
  jobName: string,
  runId: string,
  archive: ArchivePort = jobRunLogArchive(),
): Promise<string | null> {
  return archive.read(jobRunLogKey(jobName, runId));
}
