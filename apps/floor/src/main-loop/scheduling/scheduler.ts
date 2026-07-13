import cronParser from "cron-parser";
import { jobRuns } from "../../kernel/queues.js";
import { startJobRun, completeJobRun, failJobRun } from "./job-run.js";

export interface JobDef {
  name: string;
  cron: string;
  handler: () => Promise<string>;
}

const jobs = new Map<string, JobDef>();
const running = new Set<string>();

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
  for (const job of jobs.values()) {
    if (running.has(job.name)) {
      continue;
    }

    try {
      const interval = cronParser.parseExpression(job.cron);
      const prev = interval.prev().toDate();

      const last = await jobRuns().lastRun(job.name);
      const lastRun = last?.startedAt ?? null;

      if (!lastRun || lastRun < prev) {
        await runJob(job);
      }
    } catch (err) {
      console.error(`[scheduler] Error checking job ${job.name}:`, err);
    }
  }
}

async function runJob(job: JobDef): Promise<void> {
  running.add(job.name);
  const start = Date.now();
  let status = "completed";

  const runId = await startJobRun(job.name);

  try {
    const result = await job.handler();

    await completeJobRun(runId, result);
  } catch (err) {
    status = "failed";
    const message = err instanceof Error ? err.message : String(err);

    await failJobRun(runId, message);
  } finally {
    running.delete(job.name);
    const durationMs = Date.now() - start;

    console.log(`[scheduler] Job ${job.name}: ${status} (${durationMs}ms)`);
  }
}

async function checkMissedRuns(): Promise<void> {
  console.log("[scheduler] Checking for missed runs");

  for (const job of jobs.values()) {
    if (running.has(job.name)) {
      continue;
    }

    try {
      const interval = cronParser.parseExpression(job.cron);
      const prev = interval.prev().toDate();

      const last = await jobRuns().lastRun(job.name);
      const lastRun = last?.startedAt ?? null;

      if (!lastRun || lastRun < prev) {
        await runJob(job);
      }
    } catch (err) {
      console.error(
        `[scheduler] Error checking missed run for ${job.name}:`,
        err,
      );
    }
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
        lastRun: null, // populated async by callers if needed
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
