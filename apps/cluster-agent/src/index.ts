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
 */

import { HttpEventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-http.js";
import { startServer } from "./delivery/server.js";
import { startK8sWatch } from "./listeners/k8s-watch.js";
import { startSatellite } from "./satellite/start-satellite.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

/** How hard a terminal Agent-CR report tries before the Floor's reconcile cron
 *  is the only thing left to catch it. */
const REPORT_RETRY = { attempts: 5, delayMs: 500 };

/** The satellite's current per-agent token, once it has registered. Lives in
 *  the composition root because that is where the reporter and the satellite
 *  are wired together. */
let satelliteToken: string | undefined;

async function main(): Promise<void> {
  const stopServer = await startServer(PORT);
  const routerUrl = process.env.EVENT_ROUTER_URL;

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

  if (routerUrl) {
    // The central cluster reports with LORE_INGEST_TOKEN, because that is the
    // one the router VERIFIES for every route. Presenting a different token
    // that this pod happens to mount is how the 2026-08-24 outage happened:
    // each end typechecked, and every call 401'd.
    //
    // A SATELLITE has no such token by design (FR5 of
    // specs/running-stations-in-any-k8s-cluster) — so it reports with the
    // per-agent token it received at registration, which the router accepts
    // against `pipeline.cluster_agents`. Resolved per call, not captured: a
    // re-registration rotates the token, and a stale one 401s every report.
    // Without this the watch reported nothing and every node waited for the
    // reaper instead — silently, since the retry log is the only symptom.
    const reporter = new HttpEventReporter(
      routerUrl,
      () => process.env.LORE_INGEST_TOKEN ?? satelliteToken,
    );

    startK8sWatch({
      insert: (event) => reporter.insert(event),
      retry: REPORT_RETRY,
      // A 401 on a satellite's report means its token rotated (another
      // instance registered); re-register and retry, exactly like the claim
      // loop. Retrying with the same token lost run 595d2b0b's terminal event.
      onUnauthorized: () => satellite.reRegister(),
    });
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
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[cluster-agent] fatal:", err);
  process.exit(1);
});
