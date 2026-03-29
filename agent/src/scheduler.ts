import cronParser from "cron-parser";
import { query } from "./db.js";

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
  setInterval(tick, 30_000);
}

async function tick(): Promise<void> {
  for (const job of jobs.values()) {
    if (running.has(job.name)) continue;

    try {
      const interval = cronParser.parseExpression(job.cron);
      const prev = interval.prev().toDate();

      const rows = await query<{ started_at: Date }>(
        `SELECT started_at FROM pipeline.job_runs
         WHERE job_name = $1
         ORDER BY started_at DESC LIMIT 1`,
        [job.name],
      );

      const lastRun = rows[0]?.started_at ?? null;

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

  const rows = await query<{ id: string }>(
    `INSERT INTO pipeline.job_runs (job_name, status)
     VALUES ($1, 'running') RETURNING id`,
    [job.name],
  );
  const runId = rows[0].id;

  try {
    const result = await job.handler();
    await query(
      `UPDATE pipeline.job_runs
       SET completed_at = now(), status = 'completed', result_summary = $1
       WHERE id = $2`,
      [result, runId],
    );
  } catch (err) {
    status = "failed";
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE pipeline.job_runs
       SET completed_at = now(), status = 'failed', error = $1
       WHERE id = $2`,
      [message, runId],
    );
  } finally {
    running.delete(job.name);
    const durationMs = Date.now() - start;
    console.log(
      `[scheduler] Job ${job.name}: ${status} (${durationMs}ms)`,
    );
  }
}

async function checkMissedRuns(): Promise<void> {
  console.log("[scheduler] Checking for missed runs");

  for (const job of jobs.values()) {
    if (running.has(job.name)) continue;

    try {
      const interval = cronParser.parseExpression(job.cron);
      const prev = interval.prev().toDate();

      const rows = await query<{ started_at: Date }>(
        `SELECT started_at FROM pipeline.job_runs
         WHERE job_name = $1
         ORDER BY started_at DESC LIMIT 1`,
        [job.name],
      );

      const lastRun = rows[0]?.started_at ?? null;

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
