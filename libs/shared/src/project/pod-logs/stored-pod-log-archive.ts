// Stored chunks viewed as the Floor's existing PodLogArchive seam — slots in as another answer to "what stdout is retained", chained before Cloud Logging (central-only, but has older history).

import type { PodLogsRepository } from "./pod-logs-port.js";

/** What the Floor's `readAgentLogs` asks of a durable log store. */
export interface PodLogArchiveLike {
  logsForJob(
    jobName: string,
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
): PodLogArchiveLike {
  return {
    logsForJob: async (jobName, opts) => {
      const chunks = await store.listForJob(jobName);

      // Null, not "": an empty string would read as "produced no output" and stop the chain before Cloud Logging is tried.
      if (chunks.length === 0) {
        return null;
      }

      return tail(chunks.map((chunk) => chunk.lines).join(""), opts?.tailLines);
    },
  };
}

/** Try each archive in order, first non-null wins — stored chunks first (work for any cluster), Cloud Logging behind (holds pre-table history). */
export function firstAvailableArchive(
  ...archives: Array<PodLogArchiveLike | undefined>
): PodLogArchiveLike {
  return {
    logsForJob: async (jobName, opts) => {
      for (const archive of archives) {
        const logs = await archive?.logsForJob(jobName, opts);

        if (logs !== null && logs !== undefined) {
          return logs;
        }
      }

      return null;
    },
  };
}
