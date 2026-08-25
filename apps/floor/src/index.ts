import { initOtel, shutdownOtel } from "./otel-init.js";
import { createShutdown } from "./shutdown.js";
import { Llm } from "@re-cinq/lore-shared";
import { getPool, initPool } from "./kernel/db.js";
import { awaitSoleFloor } from "./kernel/single-instance.js";
import { usage } from "./kernel/queues.js";
import { loadTaskTypes } from "./kernel/config.js";
import { recoverStaleTasks, startWorker } from "./jobs/task/worker.js";
import {
  startScheduler,
  getJobStatus,
} from "./main-loop/scheduling/scheduler.js";
import { startHealthServer } from "./delivery/http/server.js";
import { loadApprovalConfig } from "@re-cinq/lore-shared";

// Event bus (the 3 layers). Layer 1 listeners: the GitHub webhook (mounted on the
// health server), the k8s Agent-CR watch, and the cron emitters below. Layer 2: the
// drain loop + reaper over pipeline.events. Layer 3: the registry's handlers (the
// existing tasks/jobs). See apps/floor/README.md + ADR-015.
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

async function main(): Promise<void> {
  console.log("[floor] Lore Floor Service starting...");

  await initOtel();

  initPool();
  Llm.configure({ usage: usage() });
  console.log("[floor] Platform: github (via project facade)");

  try {
    loadTaskTypes();
  } catch (err) {
    console.warn("[floor] Could not load task types:", err);
  }

  await loadApprovalConfig(getPool());

  const recovered = await recoverStaleTasks();

  if (recovered > 0) {
    console.log(`[floor] Recovered ${recovered} stale tasks`);
  }

  const port = parseInt(process.env.PORT || "8080", 10);
  // Awaited: the stop function is half of the shutdown contract, and a fire-and-
  // forgotten start left a late failure with nowhere to surface.
  const stopServing = await startHealthServer(port, getJobStatus);
  // ONE owner of the process lifecycle. Any handler overrides Node's default
  // terminate, so the Floor must exit itself or the drain loop keeps it alive with
  // nothing listening — the zombie shape this replaces.
  const shutdown = createShutdown({
    stopServing,
    flushTelemetry: shutdownOtel,
    exit: (code) => process.exit(code),
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Nothing below may run twice. Two Floors do not corrupt a row — SKIP LOCKED just
  // SPLITS the stream between them, so a stale instance quietly handles some events
  // with whatever code it loaded while the log you are reading stays clean.
  //
  // Deliberately AFTER the health server and the signal handlers: a Floor waiting its
  // turn is healthy, and if it served nothing while waiting, a liveness probe would
  // kill it — reproducing the crash-loop the wait exists to avoid — and any monitor
  // would report the outgoing Floor's successor as down.
  await awaitSoleFloor();

  // ── Layer 2: the drain loop + reaper over this Floor's deliveries ──
  const registry = buildRegistry();

  // BEFORE the loop, and awaited: fan-out reads the subscription set at INSERT
  // time, so an event captured before this lands is delivered to nobody and
  // simply sits there. The registry is the subscription set by construction —
  // deriving it means the Floor cannot subscribe to something it cannot handle,
  // nor handle something it never asked for.
  await subscribe([...registry.keys()].map((eventName) => ({ eventName })));

  // AFTER registering: an event captured while this Floor was not subscribed —
  // a name added by this very deploy, or the window before the first boot
  // registered at all — has no delivery row, and nothing else would ever create
  // one. A repair, not a precondition, so a failure here never stops the loop.
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

  // The store is passed in now: the stations service drains its own deliveries
  // through the same loop, so the loop cannot reach for one process's store.
  startEventLoop({
    resolve: (name) => resolve(registry, name),
    claim: claimBatch,
    markDone,
    markFailed,
    markDead,
  });
  startEventReaper();

  // ── Layer 1: the k8s Agent-CR watch (emits kubernetes.agent.* events) ──

  // ── Layer 1: cron emitters. Each scheduled tick INSERTs a cron.<name>.tick event;
  // the loop runs the handler. The set is single-sourced in cron-emitters.ts (the
  // registry cross-check test derives handler coverage from it). Heavy batch jobs stay
  // as K8s CronJob pods (ADR-019, carve-out) — they are NOT emitted here.
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
