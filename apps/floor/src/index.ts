import { Llm } from "@re-cinq/lore-shared";
import { initPool, getPool } from "./kernel/db.js";
import { loadTaskTypes } from "./kernel/config.js";
import { recoverStaleTasks, startWorker } from "./jobs/task/worker.js";
import { startScheduler, getJobStatus } from "./main-loop/scheduling/scheduler.js";
import { startHealthServer } from "./delivery/http/server.js";
import { loadApprovalConfig } from "./jobs/dark-factory/approval.js";

// Event bus (the 3 layers). Layer 1 listeners: the GitHub webhook (mounted on the
// health server), the k8s Agent-CR watch, and the cron emitters below. Layer 2: the
// drain loop + reaper over pipeline.events. Layer 3: the registry's handlers (the
// existing tasks/jobs). See apps/floor/README.md + ADR-015.
import { buildRegistry, resolve } from "./main-loop/registry.js";
import { startEventLoop } from "./main-loop/loop.js";
import { startEventReaper } from "./main-loop/reaper.js";
import { registerCronEmitter } from "./listeners/scheduler-emitter.js";
import { startK8sWatch } from "./listeners/k8s-watch.js";

async function main(): Promise<void> {
  console.log("[floor] Lore Floor Service starting...");

  initPool();
  Llm.configure({ costPool: getPool() });
  console.log("[floor] Platform: github (via project facade)");

  try {
    loadTaskTypes();
  } catch (err) {
    console.warn("[floor] Could not load task types:", err);
  }

  await loadApprovalConfig();

  const recovered = await recoverStaleTasks();
  if (recovered > 0) {
    console.log(`[floor] Recovered ${recovered} stale tasks`);
  }

  // ── Layer 2: the drain loop + reaper over pipeline.events ──
  const registry = buildRegistry();
  startEventLoop((name) => resolve(registry, name));
  startEventReaper();

  // ── Layer 1: the k8s Agent-CR watch (emits kubernetes.agent.* events) ──
  startK8sWatch();

  // ── Layer 1: cron emitters. Each scheduled tick INSERTs a cron.<name>.tick event;
  // the loop runs the handler. Heavy batch jobs stay as K8s CronJob pods (ADR-019,
  // carve-out) — they are NOT emitted here.
  registerCronEmitter("merge_check", "*/1 * * * *");
  registerCronEmitter("approval_check", "*/1 * * * *");
  // Review-reactor safety net (the GitHub webhook is the primary trigger); the
  // handler self-gates on business hours. Hourly Mon-Fri 07:07-17:07 UTC.
  registerCronEmitter("review_reactor", "7 7-17 * * 1-5");
  registerCronEmitter("spec_task_executor", "*/1 * * * *");
  registerCronEmitter("stale_task_check", "17 * * * *"); // hourly at :17
  registerCronEmitter("feature_planning_reaper", "*/1 * * * *");
  // Safety net for dropped k8s watch events: re-emit terminal-unhandled CRs + prune.
  registerCronEmitter("agent_watcher_reconcile", "*/1 * * * *");
  registerCronEmitter("events_prune", "0 * * * *"); // hourly housekeeping

  startScheduler();
  startWorker();

  const port = parseInt(process.env.PORT || "8080", 10);
  startHealthServer(port, getJobStatus);

  console.log("[floor] Lore Floor Service ready");
}

main().catch((err) => {
  console.error("[floor] Fatal:", err);
  process.exit(1);
});
