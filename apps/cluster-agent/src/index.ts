// The cluster agent: the only process that talks to this cluster's Kubernetes API, holds no database. Answers requests AND pushes (the Agent-CR watch reports onward to the event-router over HTTP) through one shared EventProxy.

import { selectEventProxy } from "@re-cinq/lore-shared/project/events/select-event-reporter.js";
import { startServer } from "./delivery/server.js";
import type { ProxyMessage } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { AgentWatchInput } from "./listeners/k8s-watch.js";
import { PodLogInput, podLogStreamingEnabled } from "./inputs/pod-log-input.js";
import { TelemetrySink } from "./kernel/telemetry-sink.js";
import { startClaimLoop } from "./claim/start-claim-loop.js";
import { startPruneLoop } from "./reap/start-prune-loop.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

/** How hard a terminal report tries before the Floor's reconcile cron is the only thing left to catch it. */
const REPORT_RETRY = { attempts: 5, delayMs: 500 };

/** How long shutdown waits for the queue to drain — long enough for a backlog, short enough a wedged router can't hold a rollout open. */
const DRAIN_TIMEOUT_MS = 5_000;

/** This agent's per-agent token once registered, lived here since the reporter and the claim loop are wired together in this composition root. */
let agentToken: string | undefined;

async function main(): Promise<void> {
  const routerUrl = process.env.EVENT_ROUTER_URL;
  const floorUrl = process.env.LORE_FLOOR_URL;

  // Claim-based dispatch (FR1/FR3, specs/running-stations-in-any-k8s-cluster) — not optional; dispatch is pull-only. Started before the watch so it can borrow its re-registration.
  const claimLoop = startClaimLoop(process.env, {
    onIdentity: (identity) => {
      agentToken = identity.token;
    },
  });

  // Terminal Agent CRs + per-task clones accumulate forever otherwise — 176 of them (40MiB) OOMKilled the controller every 9min on 2026-08-30. Runs HERE (not Floor-side) since the Floor cannot reach a satellite's cluster (#1651).
  const pruneLoop = startPruneLoop(process.env);

  // A THUNK, resolved per call: the per-agent token is unknown until registration returns and rotates out of band — capturing it at boot reported `undefined` forever (the 2026-08-24 credential-mismatch outage).
  const proxy = routerUrl
    ? selectEventProxy({
        local: () => {
          throw new Error(
            "the cluster-agent holds no database — there is no local reporter to fall back to",
          );
        },
        token: () => process.env.LORE_INGEST_TOKEN ?? agentToken,
        retry: REPORT_RETRY,
        // Telemetry rides the same queue and ladder but lands elsewhere — the Floor projects it, the router has no handler for it.
        telemetry: floorUrl
          ? new TelemetrySink(
              floorUrl,
              () => process.env.LORE_INGEST_TOKEN ?? agentToken,
            )
          : undefined,
        // A 401 means the held credential is stale — re-register and retry, as the claim/heartbeat loops do. Retrying with the refused token lost run 595d2b0b's terminal event.
        onUnauthorized: () => claimLoop.reRegister(),
      })
    : null;

  // Mounted only with somewhere to forward telemetry AND a proxy to queue it in — absent either, a 404 beats a 202 that silently drops the batch.
  const agentEvents =
    proxy && floorUrl
      ? {
          emit: (message: ProxyMessage) => proxy.emit(message),
          // Resolved per request — the per-agent token rotates on every re-registration.
          acceptedTokens: () => [process.env.LORE_INGEST_TOKEN, agentToken],
        }
      : undefined;

  const stopServer = await startServer(PORT, agentEvents);

  if (!floorUrl) {
    // Says what is off, not what is broken — a cluster posting straight to the public agent-events ingress (FR8) reports fine without this relay.
    console.log(
      "[cluster-agent] LORE_FLOOR_URL unset — agent-events relay not mounted; run pods post to their configured sink directly",
    );
  }

  if (!proxy) {
    // Loud, because the symptom is silence — no watch means no terminal Agent event reaches the bus, and every node waits for the reaper.
    console.warn(
      "[cluster-agent] EVENT_ROUTER_URL unset — Agent-CR watch NOT started",
    );
  }

  if (proxy) {
    proxy.register(new AgentWatchInput());
  }

  // OFF unless asked for — this puts log VOLUME on pipeline.events (a fan-out queue, not bulk data), so it ships dark and is enabled per cluster after a pilot.
  if (proxy && podLogStreamingEnabled(process.env)) {
    proxy.register(new PodLogInput());
  }

  if (proxy) {
    await proxy.start();
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[cluster-agent] ${signal} — shutting down`);
    // FIRST, before anything that waits — a claim landing during the drain would be recorded but never launched.
    claimLoop.stop();
    pruneLoop.stop();
    await stopServer();

    // Before exit, not after — process.exit would take the queue with it, leaving a dropped terminal event's node open until the reaper.
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
