/**
 * Persistent job-run log storage backed by GCS. Logs are redacted before writing,
 * encrypted at rest via CMEK. (The per-task log read/write helpers were removed —
 * they had no callers; only the scheduler's job-run logs are stored here.)
 */

import { Storage } from "@google-cloud/storage";
import { redactSecrets } from "@re-cinq/lore-shared";

const BUCKET_NAME = process.env.LORE_LOG_BUCKET || "lore-task-logs";
let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

export function jobRunLogKey(jobName: string, runId: string): string {
  return `__job_runs__/${jobName}/${runId}/output.log`;
}

export async function writeJobRunLogs(
  jobName: string,
  runId: string,
  rawLogs: string,
): Promise<void> {
  const redacted = redactSecrets(rawLogs);
  const bucket = getStorage().bucket(BUCKET_NAME);
  const file = bucket.file(jobRunLogKey(jobName, runId));
  await file.save(redacted, {
    resumable: false,
    contentType: "text/plain",
    metadata: {
      cacheControl: "no-cache",
    },
  });
}

export async function readJobRunLogs(
  jobName: string,
  runId: string,
): Promise<string | null> {
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const file = bucket.file(jobRunLogKey(jobName, runId));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return content.toString("utf-8");
  } catch {
    return null;
  }
}
