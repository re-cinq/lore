import { initOtel, shutdownOtel } from "./otel-init.js";
import { createShutdown } from "./shutdown.js";
import { Llm } from "@re-cinq/lore-shared";
import { getPool, initPool } from "./kernel/db.js";
import { awaitSoleFloor } from "./kernel/single-instance.js";
import { eventProxy, usage } from "./kernel/queues.js";
import { loadTaskTypes } from "./kernel/config.js";
import { wireProject } from "./composition/project-boot.js";
import { recoverStaleTasks, startWorker } from "./jobs/task/worker.js";
import {
  startScheduler,
  getJobStatus,
} from "./main-loop/scheduling/scheduler.js";
import { startHealthServer } from "./delivery/http/server.js";
import { loadApprovalConfig } from "@re-cinq/lore-shared";

// Event bus (the 3 layers): Layer 1 listeners (webhook, k8s watch, cron emitters), Layer 2 drain loop + reaper over pipeline.events, Layer 3 registry handlers. See apps/floor/README.md + ADR-015.
import { buildRegistry, resolve } from "./main-loop/registry.js";
import { startEventLoop } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  claimBatch,
  markDead,
  markDone,
  markFailed,
} from "./main-loop/store.js";
import { startEventReaper } from "./main-loop/reaper.js";
import { subscribe, reconcileDeliveries } from "./main-loop/store.js";
import { RECONCILE_WINDOW_MINUTES } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { registerCronEmitter } from "./listeners/scheduler-emitter.js";
import { CRON_EMITTERS } from "./listeners/cron-emitters.js";

/** How long shutdown waits for the event queue to drain — long enough to clear a backlog, short enough not to hold a rollout open past its termination grace period. */
const EVENT_DRAIN_TIMEOUT_MS = 5_000;

function loadTaskTypesSafely(): void {
  try {
    loadTaskTypes();
  } catch (err) {
    console.warn("[floor] Could not load task types:", err);
  }
}

// A repair, not a precondition — reconcile failure here never stops the loop.
async function reconcileBootDeliveries(): Promise<void> {
  try {
    const repaired = await reconcileDeliveries(RECONCILE_WINDOW_MINUTES);

    if (repaired > 0) {
      console.log(
        `[floor] reconciled ${repaired} deliveries missed before this boot registered`,
      );
    }
  } catch (err) {
    console.warn(
      `[floor] boot reconcile failed (${(err as Error).message}) — draining anyway`,
    );
  }
}

async function main(): Promise<void> {
  console.log("[floor] Lore Floor Service starting...");

  await initOtel();

  initPool();
  wireProject();
  Llm.configure({ usage: usage() });
  console.log("[floor] Platform: github (via project facade)");

  loadTaskTypesSafely();

  await loadApprovalConfig(getPool());

  const recovered = await recoverStaleTasks();

  if (recovered > 0) {
    console.log(`[floor] Recovered ${recovered} stale tasks`);
  }

  const port = parseInt(process.env.PORT || "8080", 10);
  // Awaited: the stop function is half of the shutdown contract — a fire-and-forgotten start left a late failure with nowhere to surface.
  const stopServing = await startHealthServer(port, getJobStatus);

  // ONE owner of the process lifecycle; started before anything can report, so an `emit` before this would otherwise sit in memory until shutdown noticed it.
  await eventProxy().start();

  const shutdown = createShutdown({
    stopServing,
    flushEvents: () => eventProxy().stop(EVENT_DRAIN_TIMEOUT_MS),
    flushTelemetry: shutdownOtel,
    exit: (code) => process.exit(code),
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Nothing below may run twice — SKIP LOCKED just SPLITS the stream between two Floors, so a stale instance quietly handles events. Deliberately AFTER the health server and signal handlers so a Floor waiting its turn stays healthy under the liveness probe.
  await awaitSoleFloor();

  // ── Layer 2: the drain loop + reaper over this Floor's deliveries ──
  const registry = buildRegistry();

  // BEFORE the loop, and awaited: fan-out reads the subscription set at INSERT time, and deriving it from the registry means the Floor never subscribes to what it can't handle.
  await subscribe([...registry.keys()].map((eventName) => ({ eventName })));

  // AFTER registering: repairs delivery rows for events captured while unsubscribed (a new name, or before first boot) — a repair, not a precondition, so failure here never stops the loop.
  await reconcileBootDeliveries();

  // The store is passed in: the stations service drains its own deliveries through the same loop, so the loop cannot reach for one process's store.
  startEventLoop({
    resolve: (name) => resolve(registry, name),
    claim: claimBatch,
    markDone,
    markFailed,
    markDead,
  });
  startEventReaper();

  // ── Layer 1: the k8s Agent-CR watch (emits kubernetes.agent.* events) ──

  // Layer 1: cron emitters, single-sourced in cron-emitters.ts; heavy batch jobs stay K8s CronJob pods (ADR-019 carve-out), NOT emitted here.
  for (const { name, schedule } of CRON_EMITTERS) {
    registerCronEmitter(name, schedule);
  }

  void startScheduler();
  void startWorker();

  console.log("[floor] Lore Floor Service ready");
}

main().catch((err) => {
  console.error("[floor] Fatal:", err);
  process.exit(1);
});
