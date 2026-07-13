/**
 * Generic batch-job entrypoint for the K8s CronJob pods produced by the
 * scheduled-job-runtime-split feature (ADR-019).
 *
 * Invoked as `node dist/job-runner.js <jobName>` inside a CronJob pod.
 * Each pod runs exactly one batch job, captures its stdout/stderr to GCS,
 * records the run in pipeline.job_runs (parity with the in-process
 * scheduler), and exits 0 / non-zero based on outcome.
 */

import { initPool, getPool } from "../kernel/db.js";
import { Llm } from "@re-cinq/lore-shared";
import { anthropicCostSyncJob } from "../jobs/cost/anthropic-cost-sync/index.js";
import { contextCoreBuilderJob } from "../jobs/context-jobs/context-core-builder/index.js";
import { evalRunnerJob } from "../jobs/context-jobs/eval-runner/index.js";
import {
  consolidationJob,
  importanceDecayJob,
} from "../jobs/memory/memory-lifecycle/index.js";
import { reindexJob } from "../jobs/context-jobs/reindex/index.js";
import { ttlCleanupJob } from "../jobs/memory/ttl-cleanup/index.js";
import {
  startJobRun,
  completeJobRun,
  failJobRun,
} from "../main-loop/scheduling/job-run.js";
import {
  jobRunLogKey,
  writeJobRunLogs,
} from "../main-loop/scheduling/log-storage.js";

type JobHandler = () => Promise<string>;

// The detection family (gap_detection / spec_drift / spec_coverage_*) left this
// table: their cron ticks fan out per-repo assembly-line runs (ADR-019 amendment).
export const dispatch: Record<string, JobHandler> = {
  context_reindex: reindexJob,
  eval_runner: evalRunnerJob,
  context_core_builder: contextCoreBuilderJob,
  importance_decay: importanceDecayJob,
  consolidation: consolidationJob,
  memory_ttl: ttlCleanupJob,
  anthropic_cost_sync: anthropicCostSyncJob,
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
  const capture =
    (label: string) =>
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
  Llm.configure({ costPool: getPool() });
  // Jobs reach GitHub/repo via the project facade (projectFor → createProject),
  // which builds its GitHub adapter from env on demand — no startup wiring needed.

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
