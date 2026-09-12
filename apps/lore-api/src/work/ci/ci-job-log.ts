import { logLines } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type { PullRequests } from "@re-cinq/lore-shared/project/pulls/pull-requests.js";

/** A bounded slice of one Actions job's log. */
export interface CiJobLog {
  job_id: number;
  lines: string[];
  total: number;
  truncated: boolean;
}

/** The job's log, bounded to a tail and optionally filtered — a reader asks for the part it needs, never the 10,000-line dump. Null when GitHub will not show the job. */
export async function readCiJobLog(
  pulls: Pick<PullRequests, "jobLog">,
  jobId: number,
  opts: { tail: number; grep?: string },
): Promise<CiJobLog | null> {
  const log = await pulls.jobLog(jobId);

  return log === null ? null : { job_id: jobId, ...logLines(log, opts) };
}
