import { initPool } from "./db.js";
import { loadTaskTypes } from "./config.js";
import { recoverStaleTasks, startWorker } from "./worker.js";
import { registerJob, startScheduler, getJobStatus } from "./scheduler.js";
import { startHealthServer } from "./health.js";

import { loadApprovalConfig } from "./approval.js";
import { approvalCheckJob } from "./jobs/scheduled/approval-check.js";
import { mergeCheckJob } from "./jobs/scheduled/merge-check.js";
import { reviewReactorJob } from "./jobs/scheduled/review-reactor.js";
import { loretaskWatcherJob } from "./jobs/scheduled/loretask-watcher.js";
import { specTaskExecutorJob } from "./jobs/scheduled/spec-task-executor.js";
import { staleTaskCheckJob } from "./jobs/scheduled/stale-task-check.js";

async function main(): Promise<void> {
  console.log("[agent] Lore Agent Service starting...");

  initPool();
  console.log("[agent] Platform: github (via project facade)");

  try {
    loadTaskTypes();
  } catch (err) {
    console.warn("[agent] Could not load task types:", err);
  }

  await loadApprovalConfig();

  const recovered = await recoverStaleTasks();
  if (recovered > 0) {
    console.log(`[agent] Recovered ${recovered} stale tasks`);
  }

  // In-process jobs: sub-minute, hot-path, or webhook-coupled. The 10
  // batch jobs that used to live here now run as K8s CronJob pods via
  // dist/job-runner.js — see ADR-019 and agent/src/jobs/cron/README.md.
  registerJob("merge_check", "*/1 * * * *", mergeCheckJob);
  registerJob("approval_check", "*/1 * * * *", approvalCheckJob);
  // Safety-net cron for review reactor. Primary trigger is the
  // GitHub webhook (see mcp-server routes); this cron catches PRs whose
  // webhook delivery was dropped. Fires hourly Mon-Fri 07:07-17:07 UTC
  // (roughly 09-19 CET/CEST); the job itself gates on business hours.
  registerJob("review_reactor", "7 7-17 * * 1-5", reviewReactorJob);
  registerJob("loretask_watcher", "*/1 * * * *", loretaskWatcherJob);
  registerJob("spec_task_executor", "*/1 * * * *", specTaskExecutorJob);
  registerJob("stale_task_check", "17 * * * *", staleTaskCheckJob);    // hourly at :17

  startScheduler();
  startWorker();

  const port = parseInt(process.env.PORT || "8080", 10);
  startHealthServer(port, getJobStatus);

  console.log("[agent] Lore Agent Service ready");
}

main().catch((err) => {
  console.error("[agent] Fatal:", err);
  process.exit(1);
});
