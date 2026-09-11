import type { Octokit } from "octokit";
import type { JobFailure } from "../pulls/pull-requests-port.js";
import { failureTail } from "../pulls/check-runs.js";
import { split } from "./platform-github-support.js";

/** GitHub Actions job reads for PlatformGitHub: what a failed job says about itself, which its check run never carries. */

/** How a failed Actions job failed: the steps that failed, and what the failing one printed. The job and its log are independent reads, so they go together. */
export async function failedJob(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<JobFailure | null> {
  const [owner, name] = split(repo);
  const params = { owner, repo: name, job_id: jobId };
  const { actions } = ok.rest;
  const [job, log] = await Promise.all([
    actions.getJobForWorkflowRun(params),
    actions.downloadJobLogsForWorkflowRun(params),
  ]);

  return {
    steps: failedStepNames(job.data.steps ?? []),
    tail: typeof log.data === "string" ? failureTail(log.data) : [],
  };
}

/** The names of the steps whose conclusion failed the job, in the order they ran. */
function failedStepNames(
  steps: ReadonlyArray<{ name: string; conclusion: string | null }>,
): string[] {
  return steps
    .filter((step) => step.conclusion === "failure")
    .map((step) => step.name);
}
