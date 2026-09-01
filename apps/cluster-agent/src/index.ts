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
import { PodLogInput, podLogStreamingEnabled } from "./inputs/pod-log-input.js";
import { TelemetrySink } from "./kernel/telemetry-sink.js";
import { startClaimLoop } from "./claim/start-claim-loop.js";
import { selectReporterToken } from "./claim/select-reporter-token.js";
import { startPruneLoop } from "./reap/start-prune-loop.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);

/** How hard a terminal report tries before the Floor's reconcile cron is the
 *  only thing left to catch it. */
const REPORT_RETRY = { attempts: 5, delayMs: 500 };

/** How long shutdown waits for the queue to drain. Long enough for a backlog to
 *  clear, short enough that a wedged router cannot hold a rollout open. */
const DRAIN_TIMEOUT_MS = 5_000;

/** This agent's per-agent token, once it has registered. Lives in the
 *  composition root because that is where the reporter and the claim loop are
 *  wired together. */
let agentToken: string | undefined;

async function main(): Promise<void> {
  const routerUrl = process.env.EVENT_ROUTER_URL;
  const floorUrl = process.env.LORE_FLOOR_URL;

  // Claim-based dispatch (specs/running-stations-in-any-k8s-cluster FR1/FR3):
  // register with the Lore API, then pull queued station runs and launch them
  // here. Not optional and not a mode — dispatch is pull-only, so an agent that
  // does not claim drains nothing. Missing configuration throws out of `main`
  // below; a failed registration ATTEMPT retries in the background and never
  // blocks the routes. Started before the watch so the watch can borrow its
  // re-registration.
  const claimLoop = startClaimLoop(process.env, {
    onIdentity: (identity) => {
      agentToken = identity.token;
    },
  });

  // A cluster forgets what it finished with. Terminal Agent CRs and the
  // per-task clones they ran on accumulate forever otherwise — 176 of them
  // (40MiB, each holding up to 256KiB of run output) OOMKilled the controller
  // every nine minutes on 2026-08-30. It runs HERE rather than Floor-side
  // because the Floor cannot reach a satellite's cluster (#1651): every cluster
  // tidies its own, central and satellite alike.
  const pruneLoop = startPruneLoop(process.env);

  // Which credential this agent reports with is chosen once at boot by
  // selectReporterToken: central clusters mount LORE_INGEST_TOKEN and report
  // with that stable capture; satellite clusters have no such token and report
  // with the per-agent token registration minted — resolved per call so
  // re-registration rotations are picked up (FR5 of
  // specs/running-stations-in-any-k8s-cluster). The old per-call fallback
  // (`LORE_INGEST_TOKEN ?? agentToken`) let LORE_INGEST_TOKEN appear on a
  // satellite after boot and shadow the per-agent token — the 2026-08-24
  // outage: each end typechecked, and every call 401'd.
  const reporterToken = selectReporterToken(process.env, () => agentToken);

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
        token: reporterToken,
        retry: REPORT_RETRY,
        // Telemetry rides the same queue and the same ladder, and lands
        // somewhere else entirely: the Floor projects it, the router would only
        // be handed volume it has no handler for.
        telemetry: floorUrl
          ? new TelemetrySink(floorUrl, reporterToken)
          : undefined,
        // A 401 means the credential this process holds is not the one the
        // registry has — an out-of-band reset, or an identity restored from a
        // stale Secret. Re-register to pick the current one up and retry, as
        // the claim and heartbeat loops do. Retrying with the refused token
        // instead lost run 595d2b0b's terminal event. (A re-registration by the
        // holder no longer rotates anything, so this is recovery, not churn.)
        onUnauthorized: () => claimLoop.reRegister(),
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
          // Resolved per request: the per-agent token rotates on every
          // re-registration, and this cluster's run pods present the copy this
          // process published into `agent-secrets`.
          acceptedTokens: () => [process.env.LORE_INGEST_TOKEN, agentToken],
        }
      : undefined;

  const stopServer = await startServer(PORT, agentEvents);

  if (!floorUrl) {
    // Says what is off, NOT what is broken. A cluster whose run pods post
    // straight to the public agent-events ingress (FR8, the original shape)
    // reports live transcripts perfectly well without this relay — claiming
    // otherwise sends an operator hunting a fault that is not there. The relay
    // is an alternative path that adds queueing and retry, not the only one.
    console.log(
      "[cluster-agent] LORE_FLOOR_URL unset — agent-events relay not mounted; run pods post to their configured sink directly",
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
    // FIRST, before anything that waits: a claim landing during the drain is a
    // visit the API records as claimed by this agent, whose launch `exit` below
    // then cuts in the middle — a claimed row with no CR, on every rollout.
    claimLoop.stop();
    pruneLoop.stop();
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
