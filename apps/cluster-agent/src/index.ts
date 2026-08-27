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
import { reportTerminalOutput } from "./satellite/report-output.js";
import type { ClusterAgentIdentity } from "./satellite/identity-store.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

/** How hard a terminal Agent-CR report tries before the Floor's reconcile cron
 *  is the only thing left to catch it. */
const REPORT_RETRY = { attempts: 5, delayMs: 500 };

/** The cluster-agent's own registered identity, once it has registered. Lives in
 *  the composition root because that is where the reporter and the satellite
 *  are wired together. The TOKEN authenticates event reports; the ID names which
 *  cluster is reporting a finished visit's output. */
let identity: ClusterAgentIdentity | undefined;

async function main(): Promise<void> {
  const stopServer = await startServer(PORT);
  const routerUrl = process.env.EVENT_ROUTER_URL;

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
      () => process.env.LORE_INGEST_TOKEN ?? identity?.token,
    );

    // The output rides the same outbound channel as the claim, and lands BEFORE
    // the event that will send a reader looking for it. Absent LORE_API_URL the
    // watch still reports events — the Floor then has a terminal phase and no
    // output, which the reaper settles rather than a verdict invented from it.
    const apiUrl = process.env.LORE_API_URL;

    startK8sWatch({
      insert: (event) => reporter.insert(event),
      reportOutput: apiUrl
        ? reportTerminalOutput({
            apiUrl,
            identity: () => {
              enforceTrue(
                identity,
                Error,
                "no registered identity to report a terminal output with",
              );

              return identity;
            },
          })
        : undefined,
      retry: REPORT_RETRY,
    });
  } else {
    // Loud, because the symptom is silence: no watch means no terminal Agent
    // event reaches the bus, and every node waits for the reaper instead.
    console.warn(
      "[cluster-agent] EVENT_ROUTER_URL unset — Agent-CR watch NOT started",
    );
  }

  // Claim-based dispatch (specs/running-stations-in-any-k8s-cluster FR1/FR3):
  // register with the Lore API, then pull queued station runs and launch them
  // here. Gated on the same station backend as the watch; a failed
  // registration retries in the background and never blocks the routes above.
  startSatellite(process.env, {
    onIdentity: (registered) => {
      identity = registered;
    },
  });

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
