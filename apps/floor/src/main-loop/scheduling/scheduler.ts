import cronParser from "cron-parser";
import { pipeline } from "../../kernel/queues.js";
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

async function runDueJobs(label: string): Promise<void> {
  for (const job of jobs.values()) {
    if (running.has(job.name)) {
      continue;
    }

    try {
      const interval = cronParser.parseExpression(job.cron);
      const prev = interval.prev().toDate();

      const last = await pipeline().jobRuns.lastRun(job.name);
      const lastRun = last?.startedAt ?? null;

      if (!lastRun || lastRun < prev) {
        await runJob(job);
      }
    } catch (err) {
      console.error(`[scheduler] Error checking ${label} ${job.name}:`, err);
    }
  }
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
    const message = err instanceof Error ? err.message : String(err);

    const failedRunId = runId;

    if (failedRunId) {
      await failJobRun(failedRunId, message);
    }

    if (!failedRunId) {
      console.error(`[scheduler] Failed to start run for ${job.name}:`, err);
    }
  } finally {
    running.delete(job.name);
    lastRuns.set(job.name, new Date(start).toISOString());
    const durationMs = Date.now() - start;

    console.log(`[scheduler] Job ${job.name}: ${status} (${durationMs}ms)`);
  }
}

export function getJobStatus(): Record<
  string,
  { lastRun: string | null; status: string; nextRun: string }
> {
  const result: Record<
    string,
    { lastRun: string | null; status: string; nextRun: string }
  > = {};

  for (const job of jobs.values()) {
    try {
      const interval = cronParser.parseExpression(job.cron);
      const nextRun = interval.next().toDate().toISOString();

      result[job.name] = {
        lastRun: lastRuns.get(job.name) ?? null,
        status: running.has(job.name) ? "running" : "idle",
        nextRun,
      };
    } catch {
      result[job.name] = {
        lastRun: null,
        status: "error",
        nextRun: "invalid cron",
      };
    }
  }

  return result;
}
