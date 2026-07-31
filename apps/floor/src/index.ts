import { initOtel, shutdownOtel } from "./otel-init.js";
import { Llm } from "@re-cinq/lore-shared";
import { initPool } from "./kernel/db.js";
import { usage } from "./kernel/queues.js";
import { loadTaskTypes } from "./kernel/config.js";
import { recoverStaleTasks, startWorker } from "./jobs/task/worker.js";
import {
  startScheduler,
  getJobStatus,
} from "./main-loop/scheduling/scheduler.js";
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
import { CRON_EMITTERS } from "./listeners/cron-emitters.js";
import { startK8sWatch } from "./listeners/k8s-watch.js";

async function main(): Promise<void> {
  console.log("[floor] Lore Floor Service starting...");

  await initOtel();
  process.on("SIGTERM", () => void shutdownOtel());

  initPool();
  Llm.configure({ usage: usage() });
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
  // the loop runs the handler. The set is single-sourced in cron-emitters.ts (the
  // registry cross-check test derives handler coverage from it). Heavy batch jobs stay
  // as K8s CronJob pods (ADR-019, carve-out) — they are NOT emitted here.
  for (const { name, schedule } of CRON_EMITTERS) {
    registerCronEmitter(name, schedule);
  }

  void startScheduler();
  void startWorker();

  const port = parseInt(process.env.PORT || "8080", 10);

  void startHealthServer(port, getJobStatus);

  console.log("[floor] Lore Floor Service ready");
}

main().catch((err) => {
  console.error("[floor] Fatal:", err);
  process.exit(1);
});
