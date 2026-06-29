// IO shell for the agent-events sink (#687): archives the raw NDJSON run stream to
// GCS for replay/debugging, alongside the pipeline.llm_calls cost rows. The object
// key is built by the pure agentEventsArchiveKey (agent-events.ts). Dormant until
// LORE_AGENT_EVENTS_BUCKET is set, so it stays a no-op until ops provision a bucket.

import { Storage } from "@google-cloud/storage";
import { redactSecrets } from "@re-cinq/lore-shared";

const BUCKET = process.env.LORE_AGENT_EVENTS_BUCKET;
let storage: Storage | null = null;

function getStorage(): Storage {
  return (storage ??= new Storage());
}

/** Archive the raw NDJSON body (redacted) at the given key. No-op when no bucket is
 *  configured. Callers fire-and-forget — a failed archive must not fail the ingest. */
export async function archiveAgentEvents(rawNdjson: string, key: string): Promise<void> {
  if (!BUCKET) return;
  await getStorage()
    .bucket(BUCKET)
    .file(key)
    .save(redactSecrets(rawNdjson), { resumable: false, contentType: "application/x-ndjson" });
}
