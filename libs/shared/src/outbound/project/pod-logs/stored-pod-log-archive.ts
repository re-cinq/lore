// Stored chunks viewed as the Floor's existing PodLogArchive seam — slots in as another answer to "what stdout is retained", chained before Cloud Logging (central-only, but has older history).

import type { PodLogChunk } from "../../../domain/models/pod-log-chunk.js";
import type { PodLogsRepository } from "./pod-logs-port.js";

/** What the Floor's `readAgentLogs` asks of a durable log store. */
export interface PodLogArchiveLike {
  logsForJob(
    jobName: string,
    opts?: { tailLines?: number },
  ): Promise<string | null>;
  /** By Agent CR name — the key a reader still holds when the CR itself is in a cluster it cannot reach. Optional: Cloud Logging is filtered by Job label only. */
  logsForAgent?(
    agentCrName: string,
    opts?: { tailLines?: number },
  ): Promise<string | null>;
}

/** Keep the last `tailLines` lines, matching `kubectl logs --tail` and the Cloud Logging fallback. */
function tail(text: string, tailLines: number | undefined): string {
  if (!tailLines) {
    return text;
  }
  const lines = text.split("\n");

  // Drop ONLY the trailing empty element a trailing newline leaves; filtering every falsy line would strip meaningful blank lines inside the log.
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.slice(-tailLines).join("\n");
}

export function storedPodLogArchive(
  store: PodLogsRepository,
): Required<PodLogArchiveLike> {
  return {
    logsForJob: (jobName, opts) => assemble(store.listForJob(jobName), opts),
    logsForAgent: (agentCrName, opts) =>
      assemble(store.listForAgent(agentCrName), opts),
  };
}

async function assemble(
  listing: Promise<PodLogChunk[]>,
  opts: { tailLines?: number } | undefined,
): Promise<string | null> {
  const chunks = await listing;

  // Null, not "": an empty string would read as "produced no output" and stop the chain before Cloud Logging is tried.
  if (chunks.length === 0) {
    return null;
  }

  return tail(chunks.map((chunk) => chunk.lines).join(""), opts?.tailLines);
}

/** Try each archive in order, first non-null wins — stored chunks first (work for any cluster), Cloud Logging behind (holds pre-table history). */
export function firstAvailableArchive(
  ...archives: Array<PodLogArchiveLike | undefined>
): Required<PodLogArchiveLike> {
  return {
    logsForJob: (jobName, opts) =>
      firstNonNull(archives, (archive) => archive.logsForJob(jobName, opts)),
    logsForAgent: (agentCrName, opts) =>
      firstNonNull(archives, (archive) =>
        archive.logsForAgent?.(agentCrName, opts),
      ),
  };
}

async function firstNonNull(
  archives: Array<PodLogArchiveLike | undefined>,
  read: (
    archive: PodLogArchiveLike,
  ) => Promise<string | null | undefined> | undefined,
): Promise<string | null> {
  for (const archive of archives) {
    const logs = archive ? await read(archive) : null;

    if (logs !== null && logs !== undefined) {
      return logs;
    }
  }

  return null;
}
