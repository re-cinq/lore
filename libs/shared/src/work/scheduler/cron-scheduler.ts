// The in-process scheduler behind the `cron.<name>.tick` events: every 30 seconds it runs each job whose cron slot has passed since its last recorded run. The last run is read from `pipeline.job_runs`, so two processes that both run it during a rollout take turns instead of doubling up, and a process that was down catches up on start.
import { CronExpressionParser } from "cron-parser";
import type { JobRunsPort } from "../../outbound/project/job-runs/job-runs-port.js";
import { cronDedupeKey } from "../../outbound/project/events/dedupe.js";
import type { CronEmitter } from "./cron-emitters.js";

interface JobDef {
  name: string;
  cron: string;
  handler: () => Promise<string>;
}

export interface JobStatus {
  lastRun: string | null;
  status: string;
  nextRun: string;
}

export interface CronScheduler {
  register(name: string, cron: string, handler: () => Promise<string>): void;
  /** Runs what is already due, then checks again every 30 seconds. */
  start(): Promise<void>;
  status(): Record<string, JobStatus>;
}

export type SchedulerJobRuns = Pick<
  JobRunsPort,
  "lastRun" | "start" | "complete" | "fail"
>;

const TICK_MS = 30_000;

export function createCronScheduler(jobRuns: SchedulerJobRuns): CronScheduler {
  return new JobRunScheduler(jobRuns);
}

class JobRunScheduler implements CronScheduler {
  private readonly jobs = new Map<string, JobDef>();
  private readonly running = new Set<string>();
  private readonly lastRuns = new Map<string, string>();

  constructor(private readonly jobRuns: SchedulerJobRuns) {}

  register(name: string, cron: string, handler: () => Promise<string>): void {
    this.jobs.set(name, { name, cron, handler });
  }

  async start(): Promise<void> {
    console.log(`[scheduler] Started with ${this.jobs.size} jobs`);
    await this.runDueJobs("missed run");
    setInterval(() => void this.runDueJobs("job"), TICK_MS);
  }

  status(): Record<string, JobStatus> {
    return Object.fromEntries(
      [...this.jobs.values()].map((job) => [
        job.name,
        jobStatus(job, {
          lastRun: this.lastRuns.get(job.name) ?? null,
          running: this.running.has(job.name),
        }),
      ]),
    );
  }

  private async runDueJobs(label: string): Promise<void> {
    for (const job of this.jobs.values()) {
      await this.runIfDue(job, label);
    }
  }

  private async runIfDue(job: JobDef, label: string): Promise<void> {
    if (this.running.has(job.name)) {
      return;
    }

    try {
      const last = await this.jobRuns.lastRun(job.name);

      if (jobIsDue(job.cron, last?.startedAt ?? null)) {
        await this.runJob(job);
      }
    } catch (err) {
      console.error(`[scheduler] Error checking ${label} ${job.name}:`, err);
    }
  }

  private async runJob(job: JobDef): Promise<void> {
    this.running.add(job.name);
    const start = Date.now();
    const status = await recordedRun(job, this.jobRuns);

    this.running.delete(job.name);
    this.lastRuns.set(job.name, new Date(start).toISOString());
    console.log(
      `[scheduler] Job ${job.name}: ${status} (${Date.now() - start}ms)`,
    );
  }
}

/** True when the job's cron schedule has fired since `lastRun` (or it never ran). */
function jobIsDue(cron: string, lastRun: Date | null): boolean {
  const prev = CronExpressionParser.parse(cron).prev().toDate();

  return !lastRun || lastRun < prev;
}

/** One run with its `job_runs` row: completed with the handler's summary, or failed with its error. A run that never started has no row to fail, so its throw is only logged. */
async function recordedRun(
  job: JobDef,
  jobRuns: SchedulerJobRuns,
): Promise<"completed" | "failed"> {
  let runId: string | null = null;

  try {
    runId = await jobRuns.start(job.name);
    await jobRuns.complete(runId, await job.handler());

    return "completed";
  } catch (err) {
    await recordFailure(job.name, runId, err, jobRuns);

    return "failed";
  }
}

async function recordFailure(
  jobName: string,
  runId: string | null,
  err: unknown,
  jobRuns: SchedulerJobRuns,
): Promise<void> {
  if (!runId) {
    console.error(`[scheduler] Failed to start run for ${jobName}:`, err);

    return;
  }
  await jobRuns.fail(runId, err instanceof Error ? err.message : String(err));
}

/** An unparseable cron is reported per job rather than failing the whole status read. */
function jobStatus(
  job: JobDef,
  seen: { lastRun: string | null; running: boolean },
): JobStatus {
  try {
    const nextRun = CronExpressionParser.parse(job.cron)
      .next()
      .toDate()
      .toISOString();

    return {
      lastRun: seen.lastRun,
      status: seen.running ? "running" : "idle",
      nextRun,
    };
  } catch {
    return { lastRun: null, status: "error", nextRun: "invalid cron" };
  }
}

/** What a cron emitter inserts: one idempotent tick per minute slot, so a tick both an old and a new process emit during a rollout is one event. */
export interface TickEvent {
  eventName: string;
  source: "cron";
  dedupeKey: string;
}

/** Registers each emitter as a job that only inserts its tick event: the work is done by whoever subscribes to it. Heavy batch jobs stay Kubernetes CronJobs (the ADR-019 carve-out) and are not emitted here. */
export function registerCronEmitters(
  scheduler: Pick<CronScheduler, "register">,
  emitters: readonly CronEmitter[],
  insert: (event: TickEvent) => Promise<void>,
): void {
  for (const { name, schedule } of emitters) {
    scheduler.register(name, schedule, async () => {
      await insert({
        eventName: `cron.${name}.tick`,
        source: "cron",
        dedupeKey: cronDedupeKey(name, new Date()),
      });

      return `emitted cron.${name}.tick`;
    });
  }
}
