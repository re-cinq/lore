/** Generic batch-job entrypoint for K8s CronJob pods (ADR-019): `node dist/job-runner.js <jobName>` runs one job, captures stdout/stderr to GCS, records the run in pipeline.job_runs, exits 0/non-zero on outcome. */

import { initPool } from "../outbound/db.js";
import { wireProject } from "../app/project-boot.js";
import { usage } from "../outbound/queues.js";
import { Llm } from "@re-cinq/lore-shared";
import { contextCoreBuilderJob } from "../work/context-jobs/context-core-builder/index.js";
import { evalRunnerJob } from "../work/context-jobs/eval-runner/index.js";
import { consolidationJob } from "../work/memory/memory-lifecycle/index.js";
import {
  startJobRun,
  completeJobRun,
  failJobRun,
} from "../events/main-loop/scheduling/job-run.js";
import {
  jobRunLogKey,
  writeJobRunLogs,
} from "../events/main-loop/scheduling/log-storage.js";

type JobHandler = () => Promise<string>;

// The detection family left this table: their cron ticks fan out per-repo assembly-line runs instead (ADR-019 amendment).
export const dispatch: Record<string, JobHandler> = {
  eval_runner: evalRunnerJob,
  context_core_builder: contextCoreBuilderJob,
  consolidation: consolidationJob,
};

export function resolveJob(name: string): JobHandler | null {
  return dispatch[name] ?? null;
}

interface ConsoleSink {
  log: typeof console.log;
  error: typeof console.error;
}

interface JobRun {
  jobName: string;
  runId: string;
  buffer: string[];
  start: number;
}

export async function runJobByName(jobName: string): Promise<number> {
  const handler = resolveJob(jobName);

  if (!handler) {
    console.error(
      `[job-runner] Unknown job: ${jobName}. Known: ${Object.keys(dispatch).join(", ")}`,
    );

    return 2;
  }

  bootJobRuntime();

  const runId = await startJobRun(jobName);

  return executeJob({ jobName, runId, buffer: [], start: Date.now() }, handler);
}

/** What a one-shot job pod needs before its handler runs. GitHub and repo access are deliberately absent: jobs reach those through the project facade, which builds its adapter from env on demand, so there is nothing to wire at startup. */
function bootJobRuntime(): void {
  initPool();
  wireProject();
  Llm.configure({ usage: usage() });
}

/** Runs the handler with the console teed into the run's buffer, restoring it on both arms so a pod that keeps going does not keep capturing. */
async function executeJob(run: JobRun, handler: JobHandler): Promise<number> {
  const originalConsole = teeConsole(run.buffer);

  try {
    const summary = await handler();

    await settleSuccess({ ...run, summary });
    restoreConsole(originalConsole);

    return 0;
  } catch (err) {
    const message = await settleFailure(run, err);

    restoreConsole(originalConsole);
    console.error(
      `[job-runner] ${run.jobName} failed in ${Date.now() - run.start}ms: ${message}`,
    );

    return 1;
  }
}

function teeConsole(buffer: string[]): ConsoleSink {
  const original: ConsoleSink = { log: console.log, error: console.error };
  const captureLog = captureInto(buffer, "[log]");
  const captureErr = captureInto(buffer, "[err]");

  console.log = (...args: unknown[]) => {
    original.log(...args);
    captureLog(...args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    captureErr(...args);
  };

  return original;
}

/** One labelled sink appending a console call to the run's log buffer. Non-string arguments are JSON-encoded because the buffer is uploaded as plain text. */
function captureInto(buffer: string[], label: string) {
  return (...args: unknown[]): void => {
    buffer.push(
      `${label} ${args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")}\n`,
    );
  };
}

/** Closes a successful run: the captured console goes to storage first, so the completed row can point at logs that already exist rather than at an upload that may still fail. */
async function settleSuccess(run: JobRun & { summary: string }): Promise<void> {
  const { jobName, runId, buffer, summary, start } = run;
  const logPath = await uploadLogsBestEffort(jobName, runId, buffer);

  await completeJobRun(runId, summary, { logPath });
  console.log(
    `[job-runner] ${jobName} completed in ${Date.now() - start}ms: ${summary}`,
  );
}

function restoreConsole(original: ConsoleSink): void {
  console.log = original.log;
  console.error = original.error;
}

/** Closes a failed run and hands back the message, so the caller can report it AFTER the console is restored — the upload has already happened by then. */
async function settleFailure(run: JobRun, err: unknown): Promise<string> {
  const { jobName, runId, buffer } = run;
  const message = err instanceof Error ? err.message : String(err);
  const logPath = await uploadLogsBestEffort(jobName, runId, buffer);

  await failJobRun(runId, message, { logPath });

  return message;
}

async function uploadLogsBestEffort(
  jobName: string,
  runId: string,
  buffer: string[],
): Promise<string | undefined> {
  try {
    await writeJobRunLogs(jobName, runId, buffer.join(""));

    return jobRunLogKey(jobName, runId);
  } catch (uploadErr) {
    console.error(
      `[job-runner] Failed to upload logs for ${jobName}/${runId}:`,
      uploadErr,
    );

    return undefined;
  }
}

function isCliEntrypoint(): boolean {
  const argv1 = process.argv[1] ?? "";

  return argv1.endsWith("job-runner.js") || argv1.endsWith("job-runner.ts");
}

function runFromCli(): void {
  const jobName = process.argv[2];

  if (!jobName) {
    console.error("Usage: node dist/job-runner.js <jobName>");
    process.exit(2);
  }
  runJobByName(jobName).then(
    (code) => process.exit(code),
    (err) => {
      console.error("[job-runner] Fatal:", err);
      process.exit(1);
    },
  );
}

if (isCliEntrypoint()) {
  runFromCli();
}
