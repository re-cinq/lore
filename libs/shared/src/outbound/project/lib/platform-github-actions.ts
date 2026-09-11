import type { Octokit } from "octokit";
import type { JobFailure } from "../pulls/pull-requests-port.js";
import { failureTail } from "../pulls/check-runs.js";
import { split } from "./platform-github-support.js";

/** GitHub Actions job reads for PlatformGitHub: what a failed job says about itself, which its check run never carries. */

/** How a failed Actions job failed, or null when GitHub will not say: an App without Actions read permission is refused. A refusal must not stop the verdict, which still goes out naming the failed checks. */
export async function failedJob(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<JobFailure | null> {
  try {
    return await readFailedJob(ok, repo, jobId);
  } catch (err) {
    console.warn(
      `[github] job ${jobId} on ${repo} unreadable (${(err as { status?: number }).status ?? "error"}); the CI verdict names its check only`,
    );

    return null;
  }
}

/** The steps that failed and what the failing one printed. The job and its log are independent reads, so they go together. */
async function readFailedJob(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<JobFailure> {
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
