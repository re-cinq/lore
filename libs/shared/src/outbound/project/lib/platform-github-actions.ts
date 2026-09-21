import type { Octokit } from "octokit";
import type { JobFailure } from "../pulls/pull-requests-port.js";
import { failureTail } from "../pulls/check-runs.js";
import { split } from "./platform-github-support.js";

/** GitHub Actions job reads for PlatformGitHub: what a failed job says about itself, which its check run never carries. */

/** How a failed Actions job failed. The job, its log and its annotations are three independent reads behind two permissions (Actions, Checks), so each settles on its own: a read GitHub refuses leaves its part empty and is named in `unreadable`, never erasing the parts that were readable. A refusal must not stop the verdict, which still goes out naming the failed checks. An Actions job's id is also its check run's id, which is what the annotations hang off. */
export async function failedJob(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<JobFailure> {
  const [owner, name] = split(repo);
  const job = { owner, repo: name, job_id: jobId };
  const settled = settledReads(repo, jobId);
  const parts = await Promise.all([
    settled("job", readFailedSteps(ok, job)),
    settled("log", readFailureTail(ok, job)),
    settled("annotations", readFailureAnnotations(ok, job)),
  ]);
  const [steps, tail, annotations] = parts.map((part) => part.lines);

  return { annotations, steps, tail, unreadable: refusedOf(parts) };
}

/** One read's outcome: what it returned, or the refusal that left it empty. */
interface SettledRead {
  lines: string[];
  refused: string | null;
}

/** A settler for one job's reads: a read GitHub refuses yields no lines, is warned about, and carries its refusal as `what (status)`. */
function settledReads(repo: string, jobId: number) {
  return (what: string, read: Promise<string[]>): Promise<SettledRead> =>
    read.then(
      (lines) => ({ lines, refused: null }),
      (err: unknown) => ({
        lines: [],
        refused: `${what} (${warnUnreadable(what, repo, jobId, err)})`,
      }),
    );
}

/** The refusals among a job's reads, in the order the reads were asked for — never the order GitHub happened to answer in. */
function refusedOf(parts: readonly SettledRead[]): string[] {
  return parts.flatMap((part) => (part.refused === null ? [] : [part.refused]));
}

type JobParams = { owner: string; repo: string; job_id: number };

/** The names of the steps that failed the job. */
async function readFailedSteps(ok: Octokit, job: JobParams): Promise<string[]> {
  const { actions } = ok.rest;
  const { data: run } = await actions.getJobForWorkflowRun(job);

  return failedStepNames(run.steps ?? []);
}

/** What the failing step printed. */
async function readFailureTail(ok: Octokit, job: JobParams): Promise<string[]> {
  return failureTail((await downloadLog(ok, job)) ?? "");
}

/** A job's raw log as GitHub serves it; null when the body is not text. */
async function downloadLog(
  ok: Octokit,
  job: JobParams,
): Promise<string | null> {
  const { actions } = ok.rest;
  const { data: log } = await actions.downloadJobLogsForWorkflowRun(job);

  return typeof log === "string" ? log : null;
}

/** The job's failure-level annotations as `path:line message`. */
async function readFailureAnnotations(
  ok: Octokit,
  { owner, repo, job_id: checkRunId }: JobParams,
): Promise<string[]> {
  return failureAnnotations(
    await readAnnotations(ok, { owner, repo, check_run_id: checkRunId }),
  );
}

/** One line per refused read, carrying GitHub's status when it gave one; returns that status for the caller's own account. */
function warnUnreadable(
  what: string,
  repo: string,
  jobId: number,
  err: unknown,
): number | "error" {
  const status = (err as { status?: number } | null)?.status ?? "error";

  console.warn(`[github] ${what} ${jobId} on ${repo} unreadable (${status})`);

  return status;
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

/** A job's raw log, or null when GitHub has no such job. A refusal (an App without Actions read permission gets 403) is thrown, so a reader is told GitHub refused rather than that the job does not exist. */
export async function jobLog(
  ok: Octokit,
  repo: string,
  jobId: number,
): Promise<string | null> {
  const [owner, name] = split(repo);

  try {
    return await downloadLog(ok, { owner, repo: name, job_id: jobId });
  } catch (err) {
    if (warnUnreadable("job log", repo, jobId, err) === 404) {
      return null;
    }
    throw err;
  }
}
