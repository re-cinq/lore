/**
 * Persistent log storage backed by GCS.
 * Logs are redacted before writing, encrypted at rest via CMEK.
 */

import { Storage } from "@google-cloud/storage";
import { redactSecrets } from "./redact.js";

const BUCKET_NAME = process.env.LORE_LOG_BUCKET || "lore-task-logs";
let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

function logPath(repo: string, taskId: string): string {
  return `${repo}/${taskId}/output.log`;
}

export async function writeLogs(repo: string, taskId: string, rawLogs: string): Promise<void> {
  const redacted = redactSecrets(rawLogs);
  const bucket = getStorage().bucket(BUCKET_NAME);
  const file = bucket.file(logPath(repo, taskId));
  await file.save(redacted, {
    resumable: false,
    contentType: "text/plain",
    metadata: {
      cacheControl: "no-cache",
    },
  });
}

export async function readLogs(repo: string, taskId: string): Promise<string | null> {
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const file = bucket.file(logPath(repo, taskId));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return content.toString("utf-8");
  } catch {
    return null;
  }
}

export async function readLogsSince(repo: string, taskId: string, offset: number): Promise<{ content: string; totalSize: number } | null> {
  try {
    const bucket = getStorage().bucket(BUCKET_NAME);
    const file = bucket.file(logPath(repo, taskId));
    const [metadata] = await file.getMetadata();
    const totalSize = Number(metadata.size || 0);
    if (offset >= totalSize) return { content: "", totalSize };
    const [content] = await file.download({ start: offset, end: totalSize - 1 });
    return { content: content.toString("utf-8"), totalSize };
  } catch {
    return null;
  }
}
