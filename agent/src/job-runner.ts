/**
 * Generic batch-job entrypoint for the K8s CronJob pods produced by the
 * scheduled-job-runtime-split feature (ADR-019).
 *
 * Invoked as `node dist/job-runner.js <jobName>` inside a CronJob pod.
 * Each pod runs exactly one batch job, captures its stdout/stderr to GCS,
 * records the run in pipeline.job_runs (parity with the in-process
 * scheduler), and exits 0 / non-zero based on outcome.
 */

import { initPool } from "./db.js";
import { autoresearchJob } from "./jobs/cron/autoresearch.js";
import { contextCoreBuilderJob } from "./jobs/cron/context-core-builder.js";
import { evalRunnerJob } from "./jobs/cron/eval-runner.js";
import { gapDetectJob } from "./jobs/cron/gap-detect.js";
import {
  consolidationJob,
  importanceDecayJob,
} from "./jobs/cron/memory-lifecycle.js";
import { reindexJob } from "./jobs/cron/reindex.js";
import { specDriftJob } from "./jobs/cron/spec-drift.js";
import { specTestLinkerJob } from "./jobs/cron/spec-test-linker.js";
import { ttlCleanupJob } from "./jobs/cron/ttl-cleanup.js";
import {
  startJobRun,
  completeJobRun,
  failJobRun,
} from "./lib/job-run.js";
import { jobRunLogKey, writeJobRunLogs } from "./lib/log-storage.js";

type JobHandler = () => Promise<string>;

export const dispatch: Record<string, JobHandler> = {
  context_reindex: reindexJob,
  eval_runner: evalRunnerJob,
  context_core_builder: contextCoreBuilderJob,
  importance_decay: importanceDecayJob,
  consolidation: consolidationJob,
  autoresearch: autoresearchJob,
  gap_detection: gapDetectJob,
  spec_drift: specDriftJob,
  spec_test_linker: specTestLinkerJob,
  memory_ttl: ttlCleanupJob,
};

export function resolveJob(name: string): JobHandler | null {
  return dispatch[name] ?? null;
}

interface ConsoleSink {
  log: typeof console.log;
  error: typeof console.error;
}

function teeConsole(buffer: string[]): ConsoleSink {
  const original: ConsoleSink = { log: console.log, error: console.error };
  const capture = (label: string) =>
    (...args: unknown[]): void => {
      buffer.push(
        `${label} ${args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" ")}\n`,
      );
    };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    capture("[log]")(...args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    capture("[err]")(...args);
  };
  return original;
}

function restoreConsole(original: ConsoleSink): void {
  console.log = original.log;
  console.error = original.error;
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

export async function runJobByName(jobName: string): Promise<number> {
  const handler = resolveJob(jobName);
  if (!handler) {
    console.error(
      `[job-runner] Unknown job: ${jobName}. Known: ${Object.keys(dispatch).join(", ")}`,
    );
    return 2;
  }

  initPool();

  const runId = await startJobRun(jobName);
  const buffer: string[] = [];
  const originalConsole = teeConsole(buffer);

  const start = Date.now();
  try {
    const summary = await handler();
    const logPath = await uploadLogsBestEffort(jobName, runId, buffer);
    await completeJobRun(runId, summary, { logPath });
    restoreConsole(originalConsole);
    console.log(
      `[job-runner] ${jobName} completed in ${Date.now() - start}ms: ${summary}`,
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const logPath = await uploadLogsBestEffort(jobName, runId, buffer);
    await failJobRun(runId, message, { logPath });
    restoreConsole(originalConsole);
    console.error(
      `[job-runner] ${jobName} failed in ${Date.now() - start}ms: ${message}`,
    );
    return 1;
  }
}

function isCliEntrypoint(): boolean {
  const argv1 = process.argv[1] ?? "";
  return argv1.endsWith("job-runner.js") || argv1.endsWith("job-runner.ts");
}

if (isCliEntrypoint()) {
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
