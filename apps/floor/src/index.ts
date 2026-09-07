import { initOtel, shutdownOtel } from "./otel-init.js";
import { createShutdown } from "./shutdown.js";
import { Llm } from "@re-cinq/lore-shared";
import { getPool, initPool } from "./outbound/db.js";
import { awaitSoleFloor } from "./outbound/single-instance.js";
import { eventProxy, usage } from "./outbound/queues.js";
import { loadTaskTypes } from "./outbound/config.js";
import { wireProject } from "./app/project-boot.js";
import { recoverStaleTasks, startWorker } from "./work/task/worker.js";
import {
  startScheduler,
  getJobStatus,
} from "./events/main-loop/scheduling/scheduler.js";
import { startHealthServer } from "./transport/http/server.js";
import { loadApprovalConfig } from "@re-cinq/lore-shared";

// Event bus (the 3 layers): Layer 1 listeners (webhook, k8s watch, cron emitters), Layer 2 drain loop + reaper over pipeline.events, Layer 3 registry handlers. See apps/floor/README.md + ADR-015.
import { buildRegistry, resolve } from "./events/main-loop/registry.js";
import { startEventLoop } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  claimBatch,
  markDead,
  markDone,
  markFailed,
} from "./outbound/event-store.js";
import { startEventReaper } from "./events/main-loop/reaper.js";
import { subscribe, reconcileDeliveries } from "./outbound/event-store.js";
import { RECONCILE_WINDOW_MINUTES } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { registerCronEmitter } from "./events/listeners/scheduler-emitter.js";
import { CRON_EMITTERS } from "./events/listeners/cron-emitters.js";

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

/** Everything that must exist before this Floor can answer anything. GitHub is absent on purpose: it is reached through the project facade, which builds its adapter from env on demand. */
async function bootRuntime(): Promise<void> {
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
}

/** Layers 1 and 2: what this Floor subscribes to, the loop that drains it, and the cron emitters that feed it. Order is load-bearing — the subscription set is read at INSERT time, so an event published before this call is delivered to nobody, and the boot reconcile after it is a REPAIR rather than a precondition, which is why its failure never stops the loop. */
async function startEventPlane(): Promise<void> {
  const registry = buildRegistry();

  // Derived from the registry, so the Floor never subscribes to what it cannot handle.
  await subscribe([...registry.keys()].map((eventName) => ({ eventName })));
  await reconcileBootDeliveries();

  // The store is passed in: the stations service drains its own deliveries through this same loop, so the loop cannot reach for one process's store.
  startEventLoop({
    resolve: (name) => resolve(registry, name),
    claim: claimBatch,
    markDone,
    markFailed,
    markDead,
  });
  startEventReaper();

  // Heavy batch jobs stay K8s CronJob pods (the ADR-019 carve-out) and are NOT emitted here.
  for (const { name, schedule } of CRON_EMITTERS) {
    registerCronEmitter(name, schedule);
  }

  void startScheduler();
  void startWorker();
}

async function main(): Promise<void> {
  console.log("[floor] Lore Floor Service starting...");

  await bootRuntime();

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

  await startEventPlane();

  console.log("[floor] Lore Floor Service ready");
}

main().catch((err) => {
  console.error("[floor] Fatal:", err);
  process.exit(1);
});
