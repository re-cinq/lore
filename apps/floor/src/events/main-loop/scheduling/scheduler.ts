import { CronExpressionParser } from "cron-parser";
import { pipeline } from "../../../outbound/queues.js";
import { startJobRun, completeJobRun, failJobRun } from "./job-run.js";

export interface JobDef {
  name: string;
  cron: string;
  handler: () => Promise<string>;
}

const jobs = new Map<string, JobDef>();
const running = new Set<string>();
const lastRuns = new Map<string, string>();

export function registerJob(
  name: string,
  cron: string,
  handler: () => Promise<string>,
): void {
  jobs.set(name, { name, cron, handler });
}

export async function startScheduler(): Promise<void> {
  console.log(`[scheduler] Started with ${jobs.size} jobs`);
  await checkMissedRuns();
  setInterval(() => void tick(), 30_000);
}

async function tick(): Promise<void> {
  await runDueJobs("job");
}

async function checkMissedRuns(): Promise<void> {
  console.log("[scheduler] Checking for missed runs");
  await runDueJobs("missed run");
}

/** True when the job's cron schedule has fired since `lastRun` (or it never ran). */
function jobIsDue(cron: string, lastRun: Date | null): boolean {
  const interval = CronExpressionParser.parse(cron);
  const prev = interval.prev().toDate();

  return !lastRun || lastRun < prev;
}

async function runIfDue(job: JobDef, label: string): Promise<void> {
  if (running.has(job.name)) {
    return;
  }

  try {
    const last = await pipeline().jobRuns.lastRun(job.name);

    if (jobIsDue(job.cron, last?.startedAt ?? null)) {
      await runJob(job);
    }
  } catch (err) {
    console.error(`[scheduler] Error checking ${label} ${job.name}:`, err);
  }
}

async function runDueJobs(label: string): Promise<void> {
  for (const job of jobs.values()) {
    await runIfDue(job, label);
  }
}

/** A run that never started has no row to fail, so its throw is only logged. */
async function recordJobFailure(
  jobName: string,
  runId: string | null,
  err: unknown,
): Promise<void> {
  if (!runId) {
    console.error(`[scheduler] Failed to start run for ${jobName}:`, err);

    return;
  }
  await failJobRun(runId, err instanceof Error ? err.message : String(err));
}

async function runJob(job: JobDef): Promise<void> {
  running.add(job.name);
  const start = Date.now();
  let status = "completed";
  let runId: string | null = null;

  try {
    runId = await startJobRun(job.name);
    const result = await job.handler();

    await completeJobRun(runId, result);
  } catch (err) {
    status = "failed";
    await recordJobFailure(job.name, runId, err);
  } finally {
    running.delete(job.name);
    lastRuns.set(job.name, new Date(start).toISOString());
    const durationMs = Date.now() - start;

    console.log(`[scheduler] Job ${job.name}: ${status} (${durationMs}ms)`);
  }
}

interface JobStatus {
  lastRun: string | null;
  status: string;
  nextRun: string;
}

/** An unparseable cron is reported per job rather than failing the whole status read. */
function jobStatus(job: JobDef): JobStatus {
  try {
    const interval = CronExpressionParser.parse(job.cron);
    const nextRun = interval.next().toDate().toISOString();

    return {
      lastRun: lastRuns.get(job.name) ?? null,
      status: running.has(job.name) ? "running" : "idle",
      nextRun,
    };
  } catch {
    return { lastRun: null, status: "error", nextRun: "invalid cron" };
  }
}

export function getJobStatus(): Record<string, JobStatus> {
  const result: Record<string, JobStatus> = {};

  for (const job of jobs.values()) {
    result[job.name] = jobStatus(job);
  }

  return result;
}
