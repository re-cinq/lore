// IO shell for the agent-events sink (#687): archives the raw NDJSON run stream
// through the shared ArchivePort, alongside the pipeline.llm_calls cost rows. The
// object key is built by the pure agentEventsArchiveKey (agent-events.ts).
// Redaction stays here — what leaves the Floor is Floor policy, not the port's.

import { redactSecrets } from "@re-cinq/lore-shared";
import type { ArchivePort } from "@re-cinq/lore-shared/project/archive/archive-port.js";
import { agentEventsArchive } from "../../kernel/archives.js";

/** Archive the raw NDJSON body (redacted) at the given key. No-op when no bucket is
 *  configured. Callers fire-and-forget — a failed archive must not fail the ingest. */
export async function archiveAgentEvents(
  rawNdjson: string,
  key: string,
  archive: ArchivePort | null = agentEventsArchive(),
): Promise<void> {
  if (!archive) {
    return;
  }
  await archive.save(key, redactSecrets(rawNdjson), {
    contentType: "application/x-ndjson",
  });
}
