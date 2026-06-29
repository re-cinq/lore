import { Llm } from "@re-cinq/lore-shared";
import { initPool, getPool } from "./kernel/db.js";
import { loadTaskTypes } from "./kernel/config.js";
import { recoverStaleTasks, startWorker } from "./task/worker.js";
import { registerJob, startScheduler, getJobStatus } from "./scheduling/scheduler.js";
import { startHealthServer } from "./delivery/health.js";

import { loadApprovalConfig } from "./dark-factory/approval.js";
import { approvalCheckJob } from "./dark-factory/approval-check.js";
import { mergeCheckJob } from "./merge/merge-check.js";
import { reviewReactorJob } from "./review/review-reactor.js";
import { agentWatcherJob } from "./watcher/agent-watcher.js";
import { specTaskExecutorJob } from "./task/spec-task-executor.js";
import { staleTaskCheckJob } from "./task/stale-task-check.js";
import { featurePlanningReaperJob } from "./task/feature-planning-reaper.js";

async function main(): Promise<void> {
  console.log("[agent] Lore Agent Service starting...");

  initPool();
  Llm.configure({ costPool: getPool() });
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
  // dist/job-runner.js — see ADR-019 and application/jobs/cron/README.md.
  registerJob("merge_check", "*/1 * * * *", mergeCheckJob);
  registerJob("approval_check", "*/1 * * * *", approvalCheckJob);
  // Safety-net cron for review reactor. Primary trigger is the
  // GitHub webhook (see mcp-server routes); this cron catches PRs whose
  // webhook delivery was dropped. Fires hourly Mon-Fri 07:07-17:07 UTC
  // (roughly 09-19 CET/CEST); the job itself gates on business hours.
  registerJob("review_reactor", "7 7-17 * * 1-5", reviewReactorJob);
  // Polls Agent CRs (ai-agent-subsystem) and creates the PR on completion.
  registerJob("agent_watcher", "*/1 * * * *", agentWatcherJob);
  registerJob("spec_task_executor", "*/1 * * * *", specTaskExecutorJob);
  registerJob("stale_task_check", "17 * * * *", staleTaskCheckJob);    // hourly at :17
  // Heals planning rounds whose Station container/pod died mid-flight (the wizard
  // would otherwise "analyze" forever) and re-applies any missed status transition.
  registerJob("feature_planning_reaper", "*/1 * * * *", featurePlanningReaperJob);

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
