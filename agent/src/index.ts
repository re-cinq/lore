import { initPool } from "./db.js";
import { setPlatform } from "./platform.js";
import { GitHubPlatform } from "./github.js";
import { loadTaskTypes } from "./config.js";
import { recoverStaleTasks, startWorker } from "./worker.js";
import { registerJob, startScheduler, getJobStatus } from "./scheduler.js";
import { startHealthServer } from "./health.js";

import { mergeCheckJob } from "./jobs/merge-check.js";
import { ttlCleanupJob } from "./jobs/ttl-cleanup.js";
import { reindexJob } from "./jobs/reindex.js";
import { gapDetectJob } from "./jobs/gap-detect.js";
import { specDriftJob } from "./jobs/spec-drift.js";
import { reviewReactorJob } from "./jobs/review-reactor.js";

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

  const recovered = await recoverStaleTasks();
  if (recovered > 0) {
    console.log(`[agent] Recovered ${recovered} stale tasks`);
  }

  registerJob("merge_check", "*/1 * * * *", mergeCheckJob);
  registerJob("review_reactor", "*/5 * * * *", reviewReactorJob);
  registerJob("memory_ttl", "0 * * * *", ttlCleanupJob);
  registerJob("context_reindex", "0 2 * * *", reindexJob);
  registerJob("gap_detection", "0 9 * * 1", gapDetectJob);
  registerJob("spec_drift", "0 10 * * 1", specDriftJob);

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
