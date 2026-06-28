import { Llm } from "@re-cinq/lore-shared";
import { initPool, getPool } from "../data/db.js";
import { loadTaskTypes } from "../data/config.js";
import { recoverStaleTasks, startWorker } from "../application/task-processing/worker.js";
import { registerJob, startScheduler, getJobStatus } from "../application/scheduling/scheduler.js";
import { startHealthServer } from "./health.js";

import { loadApprovalConfig } from "../adapters/approval/approval.js";
import { approvalCheckJob } from "../application/jobs/scheduled/approval-check.js";
import { mergeCheckJob } from "../application/jobs/scheduled/merge-check.js";
import { reviewReactorJob } from "../application/jobs/scheduled/review-reactor.js";
import { loretaskWatcherJob } from "../application/jobs/scheduled/loretask-watcher.js";
import { agentWatcherJob } from "../application/jobs/scheduled/agent-watcher.js";
import { specTaskExecutorJob } from "../application/jobs/scheduled/spec-task-executor.js";
import { staleTaskCheckJob } from "../application/jobs/scheduled/stale-task-check.js";
import { reclaimOrphanedIngestJob } from "../application/jobs/scheduled/reclaim-orphaned-ingest.js";
import { featurePlanningReaperJob } from "../application/jobs/scheduled/feature-planning-reaper.js";

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
  registerJob("loretask_watcher", "*/1 * * * *", loretaskWatcherJob);
  // ADR-031 cutover: polls Agent CRs, runs alongside loretask_watcher (disjoint groups).
  registerJob("agent_watcher", "*/1 * * * *", agentWatcherJob);
  registerJob("spec_task_executor", "*/1 * * * *", specTaskExecutorJob);
  registerJob("stale_task_check", "17 * * * *", staleTaskCheckJob);    // hourly at :17
  // Recurring orphan recovery: resets graph-ingest tasks stranded in `running`
  // by a mid-batch pod roll back to `pending` (idempotent re-run). Every 10 min.
  registerJob("reclaim_orphaned_ingest", "*/10 * * * *", reclaimOrphanedIngestJob);
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
