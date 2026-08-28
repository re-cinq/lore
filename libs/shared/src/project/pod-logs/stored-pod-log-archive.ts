/**
 * The stored chunks, viewed as the Floor's existing `PodLogArchive` seam.
 *
 * That seam already exists for the Cloud Logging fallback and is asked exactly
 * one question — "what stdout is retained for this Job?" — so the stored chunks
 * slot in as another answer to it rather than as a new branch inside
 * `readAgentLogs`. Returning null when it holds nothing is what lets the two be
 * chained: stored first (it works for every cluster), Cloud Logging behind it
 * (central only, but it has history predating this table).
 */

import type { PodLogsRepository } from "./pod-logs-port.js";

/** What the Floor's `readAgentLogs` asks of a durable log store. */
export interface PodLogArchiveLike {
  logsForJob(
    jobName: string,
    opts?: { tailLines?: number },
  ): Promise<string | null>;
}

/** Keep the last `tailLines` lines, matching what a `kubectl logs --tail` and
 *  the Cloud Logging fallback both return. */
function tail(text: string, tailLines: number | undefined): string {
  if (!tailLines) {
    return text;
  }
  const lines = text.split("\n");

  // Drop ONLY the empty trailing element a trailing newline leaves behind.
  // Filtering every falsy line would strip the blank lines inside the log —
  // which in a stack trace or a diff is content, not padding.
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

      // Null, not "": the seam's contract is "nothing retained", and an empty
      // string would read as a pod that genuinely produced no output and stop
      // the chain before Cloud Logging is tried.
      if (chunks.length === 0) {
        return null;
      }

      return tail(chunks.map((chunk) => chunk.lines).join(""), opts?.tailLines);
    },
  };
}

/**
 * Try each archive in order, first non-null wins.
 *
 * Stored chunks come first because they are the only source that works for a
 * run executed in a cluster the Floor cannot reach; Cloud Logging stays behind
 * them because it holds history from before this table existed.
 */
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
