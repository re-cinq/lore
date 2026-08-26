/**
 * The satellite composition shell: register with the Lore API, then run the
 * claim loop, launching claimed specs as Agent CRs in this cluster through the
 * same local adapters the inbound /agents routes use — no HTTP loopback.
 *
 * Like the k8s watch, this file is the CONNECTION; every decision it wires
 * (registration, backoff, claim ticks) lives in the injectable modules beside
 * it and tests without a cluster. Registration failure never crashes the
 * process — the inbound-push path keeps working while boot retries on the
 * 30s→5m schedule.
 */

import { selectStationBackend } from "@re-cinq/lore-shared";
import { AgentCrBackend } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import type { ContextSource } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { KubeAgentApi } from "../kernel/kube-agent-api.js";
import { kubeTokenProvisioner } from "../kernel/deps.js";
import { ApiContextSource } from "./api-context-source.js";
import { claimIntervalMs, claimOnce, runClaimLoop } from "./claim-loop.js";
import {
  heartbeatIntervalMs,
  heartbeatOnce,
  runHeartbeatLoop,
} from "./heartbeat-loop.js";
import { FileIdentityStore, identityFilePath } from "./identity-store.js";
import type { ClusterAgentIdentity, IdentityStore } from "./identity-store.js";
import {
  registerOnce,
  registerWithBackoff,
  registrationConfig,
} from "./registration.js";
import type { RegistrationConfig } from "./registration.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Central clusters hold LORE_INGEST_TOKEN and hydrate claimed runs; a
 *  satellite does not (FR5 keeps that token central), so its runs launch
 *  unhydrated — agent pods still have live context through the lore-mcp
 *  gateway. */
function contextSource(
  env: NodeJS.ProcessEnv,
  apiUrl: string,
): ContextSource | undefined {
  const token = env.LORE_INGEST_TOKEN;

  return token ? new ApiContextSource(apiUrl, token) : undefined;
}

async function runSatellite(opts: {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  store: IdentityStore;
  backend: AgentCrBackend;
}): Promise<void> {
  const { env, config, store, backend } = opts;
  let identity: ClusterAgentIdentity = await registerWithBackoff({
    config,
    store,
    sleep,
  });

  console.log(
    `[cluster-agent] registered as ${config.name} (${identity.id}), tags [${config.tags.join(", ")}] — claim loop starting`,
  );

  // Single-flight: the heartbeat and claim loops can 401 in the same window,
  // and two overlapping re-registrations would rotate the token twice — the
  // first rotation's holder immediately 401s again. Both callers await the
  // same in-flight attempt instead.
  let reRegistration: Promise<ClusterAgentIdentity | null> | null = null;
  const reRegister = (): Promise<ClusterAgentIdentity | null> =>
    (reRegistration ??= registerOnce({ config, store })
      .then((rotated) => {
        if (rotated) {
          identity = rotated;
        }

        return rotated;
      })
      .finally(() => {
        reRegistration = null;
      }));

  // The heartbeat rides beside the claim loop, not inside it: a satellite busy
  // executing a long claim must still look alive.
  void runHeartbeatLoop({
    beat: () =>
      heartbeatOnce({ apiUrl: config.apiUrl, identity: () => identity }),
    reRegister,
    sleep,
    intervalMs: heartbeatIntervalMs(env),
  }).catch((err) => {
    console.error("[cluster-agent] heartbeat loop crashed:", err);
  });

  await runClaimLoop({
    claim: () =>
      claimOnce({
        apiUrl: config.apiUrl,
        identity: () => identity,
        launch: (spec) => backend.launch(spec),
      }),
    reRegister,
    sleep,
    baseDelayMs: claimIntervalMs(env),
  });
}

/** Start registration + the claim loop. No-op without a cluster to launch into
 *  or without the registration env triple. */
export function startSatellite(env: NodeJS.ProcessEnv): void {
  if (selectStationBackend(env) !== "k8s") {
    console.log(
      "[cluster-agent] claim loop disabled (station backend is not k8s)",
    );

    return;
  }
  const config = registrationConfig(env);

  if (!config) {
    console.log(
      "[cluster-agent] registration disabled — set LORE_API_URL, LORE_CLUSTER_AGENT_REGISTRATION_TOKEN and LORE_CLUSTER_AGENT_NAME to enable claim-based dispatch",
    );

    return;
  }

  const backend = new AgentCrBackend(
    new KubeAgentApi(),
    contextSource(env, config.apiUrl),
    kubeTokenProvisioner(),
  );

  void runSatellite({
    env,
    config,
    store: new FileIdentityStore(identityFilePath(env)),
    backend,
  }).catch((err) => {
    // Unreachable by design (register + claim never throw), but a defect here
    // must surface as a log, not an unhandled rejection killing the process.
    console.error("[cluster-agent] satellite loop crashed:", err);
  });
}
