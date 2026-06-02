import { initPool } from "./db.js";
import { setPlatform } from "./platform.js";
import { GitHubPlatform } from "./github.js";
import { loadTaskTypes } from "./config.js";
import { recoverStaleTasks, startWorker } from "./worker.js";
import { registerJob, startScheduler, getJobStatus } from "./scheduler.js";
import { startHealthServer } from "./health.js";

import { loadApprovalConfig } from "./approval.js";
import { approvalCheckJob } from "./jobs/scheduled/approval-check.js";
import { mergeCheckJob } from "./jobs/scheduled/merge-check.js";
import { ttlCleanupJob } from "./jobs/cron/ttl-cleanup.js";
import { reindexJob } from "./jobs/cron/reindex.js";
import { gapDetectJob } from "./jobs/cron/gap-detect.js";
import { specDriftJob } from "./jobs/cron/spec-drift.js";
import { specTestLinkerJob } from "./jobs/cron/spec-test-linker.js";
import { reviewReactorJob } from "./jobs/scheduled/review-reactor.js";
import { evalRunnerJob } from "./jobs/cron/eval-runner.js";
import { autoresearchJob } from "./jobs/cron/autoresearch.js";
import { contextCoreBuilderJob } from "./jobs/cron/context-core-builder.js";
import { loretaskWatcherJob } from "./jobs/scheduled/loretask-watcher.js";
import { specTaskExecutorJob } from "./jobs/scheduled/spec-task-executor.js";
import { importanceDecayJob, consolidationJob } from "./jobs/cron/memory-lifecycle.js";
import { staleTaskCheckJob } from "./jobs/scheduled/stale-task-check.js";

async function main(): Promise<void> {
  console.log("[agent] Lore Agent Service starting...");

  initPool();
  setPlatform(new GitHubPlatform());
  console.log("[agent] Platform: github");

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

  registerJob("merge_check", "*/1 * * * *", mergeCheckJob);
  registerJob("approval_check", "*/1 * * * *", approvalCheckJob);
  // Safety-net cron for review reactor. Primary trigger is the
  // GitHub webhook (see mcp-server routes); this cron catches PRs whose
  // webhook delivery was dropped. Fires hourly Mon-Fri 07:07-17:07 UTC
  // (roughly 09-19 CET/CEST); the job itself gates on business hours.
  registerJob("review_reactor", "7 7-17 * * 1-5", reviewReactorJob);
  registerJob("memory_ttl", "0 * * * *", ttlCleanupJob);
  registerJob("context_reindex", "0 2 * * *", reindexJob);
  registerJob("gap_detection", "0 9 * * 1", gapDetectJob);
  registerJob("spec_drift", "0 10 * * 1", specDriftJob);
  registerJob("spec_test_linker", "0 11 * * 1", specTestLinkerJob);
  registerJob("eval_runner", "0 3 * * *", evalRunnerJob);
  registerJob("context_core_builder", "0 4 * * *", contextCoreBuilderJob);
  registerJob("autoresearch", "0 6 * * 1", autoresearchJob);
  registerJob("loretask_watcher", "*/1 * * * *", loretaskWatcherJob);
  registerJob("spec_task_executor", "*/1 * * * *", specTaskExecutorJob);
  registerJob("importance_decay", "0 5 * * *", importanceDecayJob);    // daily 5 AM
  registerJob("consolidation", "30 5 * * *", consolidationJob);        // daily 5:30 AM
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
