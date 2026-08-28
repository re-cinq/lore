/**
 * The cluster agent: the only process that talks to this cluster's Kubernetes
 * API. It holds no database — every caller brings its own state and asks this
 * for cluster operations only.
 *
 * It answers requests AND it pushes. Everything the API can be asked for is a
 * route on this server; the one thing it cannot be asked for is a WATCH, which
 * Kubernetes delivers down a connection this process opens outward. That is why
 * the Agent-CR watch lives here and reports onward to the event-router over
 * HTTP, rather than the router opening a watch of its own: a router that watched
 * directly could only ever see the one cluster it runs in, and one cluster-agent
 * per cluster reporting inward is what lets there be more than one.
 *
 * Everything it pushes goes through one `EventProxy` — one queue, one retry
 * ladder, one credential rotation — which the inputs register with rather than
 * each carrying a delivery policy of its own.
 */

import { selectEventProxy } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import { startServer } from "./delivery/server.js";
import type { ProxyMessage } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { AgentWatchInput } from "./listeners/k8s-watch.js";
import {
  PodLogInput,
  podLogStreamingEnabled,
} from "./inputs/pod-log-input.js";
import { TelemetrySink } from "./kernel/telemetry-sink.js";
import { startSatellite } from "./satellite/start-satellite.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

/** How hard a terminal report tries before the Floor's reconcile cron is the
 *  only thing left to catch it. */
const REPORT_RETRY = { attempts: 5, delayMs: 500 };

/** How long shutdown waits for the queue to drain. Long enough for a backlog to
 *  clear, short enough that a wedged router cannot hold a rollout open. */
const DRAIN_TIMEOUT_MS = 5_000;

/** The satellite's current per-agent token, once it has registered. Lives in
 *  the composition root because that is where the reporter and the satellite
 *  are wired together. */
let satelliteToken: string | undefined;

async function main(): Promise<void> {
  const routerUrl = process.env.EVENT_ROUTER_URL;
  const floorUrl = process.env.LORE_FLOOR_URL;

  // Claim-based dispatch (specs/running-stations-in-any-k8s-cluster FR1/FR3):
  // register with the Lore API, then pull queued station runs and launch them
  // here. Gated on the same station backend as the watch; a failed
  // registration retries in the background and never blocks the routes above.
  // Started before the watch so the watch can borrow its re-registration.
  const satellite = startSatellite(process.env, {
    onIdentity: (identity) => {
      satelliteToken = identity.token;
    },
  });

  // The central cluster reports with LORE_INGEST_TOKEN, because that is the one
  // the router VERIFIES for every route. Presenting a different token that this
  // pod happens to mount is how the 2026-08-24 outage happened: each end
  // typechecked, and every call 401'd.
  //
  // A SATELLITE has no such token by design (FR5 of
  // specs/running-stations-in-any-k8s-cluster) — so it reports with the
  // per-agent token it received at registration, which the router accepts
  // against `pipeline.cluster_agents`. A THUNK, resolved per call rather than
  // captured: a re-registration rotates the token, and a stale one 401s every
  // report. Without this the watch reported nothing and every node waited for
  // the reaper instead — silently, since the retry log is the only symptom.
  //
  // Built only when there is a router to report to. This process holds no pool,
  // so the selector's local fallback cannot exist here; asking for one would
  // turn a missing variable into a crashed boot, and the routes below work
  // without a router.
  const proxy = routerUrl
    ? selectEventProxy({
        local: () => {
          throw new Error(
            "the cluster-agent holds no database — there is no local reporter to fall back to",
          );
        },
        token: () => process.env.LORE_INGEST_TOKEN ?? satelliteToken,
        retry: REPORT_RETRY,
        // Telemetry rides the same queue and the same ladder, and lands
        // somewhere else entirely: the Floor projects it, the router would only
        // be handed volume it has no handler for.
        telemetry: floorUrl
          ? new TelemetrySink(
              floorUrl,
              () => process.env.LORE_INGEST_TOKEN ?? satelliteToken,
            )
          : undefined,
        // A 401 on a satellite's report means its token rotated (another
        // instance registered); re-register and retry, exactly like the claim
        // loop. Retrying with the same token lost run 595d2b0b's terminal event.
        onUnauthorized: () => satellite.reRegister(),
      })
    : null;

  // Mounted only when this cluster has somewhere to forward telemetry AND a
  // proxy to queue it in. Absent either, the route is not registered at all: a
  // 404 tells a run pod its sink is misconfigured, where a 202 that drops the
  // batch would look exactly like a quiet run.
  const agentEvents =
    proxy && floorUrl
      ? {
          emit: (message: ProxyMessage) => proxy.emit(message),
          // Resolved per request: a satellite's per-agent token rotates on
          // every re-registration, and its own run pods present the copy this
          // process published into `agent-secrets`.
          acceptedTokens: () => [process.env.LORE_INGEST_TOKEN, satelliteToken],
        }
      : undefined;

  const stopServer = await startServer(PORT, agentEvents);

  if (!floorUrl) {
    console.warn(
      "[cluster-agent] LORE_FLOOR_URL unset — agent telemetry relay NOT mounted; this cluster's runs report no live transcript",
    );
  }

  if (proxy) {
    proxy.register(new AgentWatchInput());

    // OFF unless asked for. This is the input that puts log VOLUME on
    // `pipeline.events` — a dispatch queue built for handler fan-out, not bulk
    // data — so it ships dark and is enabled per cluster after a pilot, rather
    // than arriving with a deploy.
    if (podLogStreamingEnabled(process.env)) {
      proxy.register(new PodLogInput());
    }
    await proxy.start();
  } else {
    // Loud, because the symptom is silence: no watch means no terminal Agent
    // event reaches the bus, and every node waits for the reaper instead.
    console.warn(
      "[cluster-agent] EVENT_ROUTER_URL unset — Agent-CR watch NOT started",
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[cluster-agent] ${signal} — shutting down`);
    await stopServer();

    // Before exit, not after: `process.exit` would take the queue with it, and
    // a terminal event dropped on a rollout leaves its node open until the
    // reaper.
    const undrained = (await proxy?.stop(DRAIN_TIMEOUT_MS)) ?? 0;

    if (undrained > 0) {
      console.error(
        `[cluster-agent] exited with ${undrained} undelivered event(s) — the Floor's reconcile cron is what re-emits them`,
      );
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[cluster-agent] fatal:", err);
  process.exit(1);
});
