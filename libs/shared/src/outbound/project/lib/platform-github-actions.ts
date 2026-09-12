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
    warnUnreadable("job", repo, jobId, err);

    return null;
  }
}

/** One line per refused read, carrying GitHub's status when it gave one. */
function warnUnreadable(
  what: string,
  repo: string,
  jobId: number,
  err: unknown,
) {
  const status = (err as { status?: number }).status ?? "error";

  console.warn(`[github] ${what} ${jobId} on ${repo} unreadable (${status})`);
}

/** The failure annotations, the steps that failed and what the failing one printed. The three are independent reads, so they go together. An Actions job's id is also its check run's id, which is what the annotations hang off. */
async function readFailedJob(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<JobFailure> {
  const [owner, name] = split(repo);
  const params = { owner, repo: name, job_id: jobId };
  const { actions } = ok.rest;
  const [job, log, annotations] = await Promise.all([
    actions.getJobForWorkflowRun(params),
    actions.downloadJobLogsForWorkflowRun(params),
    readAnnotations(ok, { owner, repo: name, check_run_id: jobId }),
  ]);

  return {
    annotations: failureAnnotations(annotations),
    steps: failedStepNames(job.data.steps ?? []),
    tail: typeof log.data === "string" ? failureTail(log.data) : [],
  };
}

/** Every annotation on a check run, paginated: a lint step files one per finding, and one page holds 100. */
async function readAnnotations(
  ok: Octokit,
  params: { owner: string; repo: string; check_run_id: number },
) {
  const { checks } = ok.rest;

  return ok.paginate(checks.listAnnotations, {
    ...params,
    per_page: 100,
  });
}

/** The level GitHub gives an annotation a step's tooling reported as an error; warnings and notices are the noise a 10,000-line lint report is mostly made of. */
const FAILURE_LEVEL = "failure";

/** Each error-level annotation as `path:line message` — the form a reader (or an agent) opens a file on. */
function failureAnnotations(
  annotations: ReadonlyArray<{
    path: string;
    start_line: number;
    annotation_level: string | null;
    message: string | null;
  }>,
): string[] {
  return annotations
    .filter((a) => a.annotation_level === FAILURE_LEVEL)
    .map((a) => `${a.path}:${a.start_line} ${a.message ?? ""}`.trimEnd());
}

/** The names of the steps whose conclusion failed the job, in the order they ran. */
function failedStepNames(
  steps: ReadonlyArray<{ name: string; conclusion: string | null }>,
): string[] {
  return steps
    .filter((step) => step.conclusion === "failure")
    .map((step) => step.name);
}

/** A job's raw log, or null when GitHub refuses — the same refusal failedJob tolerates, surfaced to a reader as "GitHub will not show this" rather than as a thrown 403. */
export async function jobLog(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<string | null> {
  const [owner, name] = split(repo);
  const { actions } = ok.rest;

  try {
    const { data: log } = await actions.downloadJobLogsForWorkflowRun({
      owner,
      repo: name,
      job_id: jobId,
    });

    return typeof log === "string" ? log : null;
  } catch (err) {
    warnUnreadable("job log", repo, jobId, err);

    return null;
  }
}
