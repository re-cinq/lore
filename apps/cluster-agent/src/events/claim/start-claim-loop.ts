// Registrant shell: registers, then runs the claim loop launching Agent CRs. EVERY cluster-agent runs this (dispatch is pull-only, FR3); registration failure never crashes the process, it retries on the 30s→5m schedule.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { selectStationBackend } from "@re-cinq/lore-shared";
import { AgentCrBackend } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { KubeAgentApi } from "../../outbound/kube-agent-api.js";
import { kubeTokenProvisioner } from "../../outbound/deps.js";
import { KubeSecretKeyWriter } from "../../outbound/kube-token-provisioner.js";
import { writeAgentEventsAuth } from "./agent-events-secret.js";
import { stopLatch } from "../../lib/stop-latch.js";
import { runRegistrant, type RegistrantOpts } from "./registrant.js";
import { enforceCatalogProfile } from "../../work/catalog/catalog-sync-loop.js";
import {
  FileIdentityStore,
  identityStoreConfig,
} from "../../outbound/identity-store.js";
import type {
  ClusterAgentIdentity,
  IdentityStore,
  IdentityStoreConfig,
} from "../../domain/identity.js";
import {
  KubeIdentityStore,
  kubeIdentitySecretsApi,
} from "../../outbound/kube-identity-store.js";
import { registrationConfig } from "./registration.js";
import type { RegistrationConfig } from "./registration.js";

/** Everything that must hold before this process is worth starting, decided SYNCHRONOUSLY so a failure is a refusal rather than a log line under a Ready pod. A cluster-agent IS its cluster's Kubernetes client — without one it can neither launch nor watch. The catalog profile is checked here because two unset render values once produced pods that died at boot cluster-wide (2026-09-01), and the identity store's namespace because a missing one used to land in the async catch: one log line, pod Ready, nothing ever registered. */
function assertBootable(env: NodeJS.ProcessEnv): {
  config: RegistrationConfig;
  storeConfig: IdentityStoreConfig;
} {
  enforceTrue(
    selectStationBackend(env) === "k8s",
    Error,
    "cluster-agent cannot start: the station backend is not k8s. This process launches claimed runs as Agent CRs — set LORE_STATION_BACKEND=k8s and point LORE_KUBECONFIG at the cluster.",
  );
  enforceCatalogProfile(env);

  return {
    config: registrationConfig(env),
    storeConfig: identityStoreConfig(env),
  };
}

export interface StartClaimLoopOpts {
  /** Called with the identity after EVERY successful registration (including rotation) so the event reporter's credential stays current. */
  onIdentity?: (identity: ClusterAgentIdentity) => void;
}

export interface ClaimLoopHandle {
  /** Stop claiming — a shutdown flips this before waiting for anything else, since a claim landing mid-drain would be recorded but never launched. */
  stop: () => void;
  /** Rotates the per-agent token via single-flight re-registration; resolves null until this agent has registered once. */
  reRegister: () => Promise<unknown>;
}

/** Detached on purpose: `startClaimLoop` returns a handle immediately so a caller can stop the agent before it has finished registering. The catch is unreachable by design — register and claim never throw — but a defect here must surface as a log rather than an unhandled rejection that kills the process. */
function launchRegistrant(
  storeConfig: IdentityStoreConfig,
  opts: Omit<RegistrantOpts, "store">,
): void {
  void buildIdentityStore(storeConfig)
    .then((store) => runRegistrant({ ...opts, store }))
    .catch((err) => {
      console.error(
        "[cluster-agent] claim loop crashed — this agent will not register or claim until restarted:",
        err,
      );
    });
}

export function startClaimLoop(
  env: NodeJS.ProcessEnv,
  opts: StartClaimLoopOpts = {},
): ClaimLoopHandle {
  let reRegister: (() => Promise<unknown>) | null = null;
  const latch = stopLatch();
  const { config, storeConfig } = assertBootable(env);

  const backend = new AgentCrBackend(
    new KubeAgentApi(),
    kubeTokenProvisioner(),
  );

  // The same Secret writer the per-task GitHub provisioner uses — a merge into `agent-secrets`, not a replace, since both write to it.
  const secrets = new KubeSecretKeyWriter();

  launchRegistrant(storeConfig, {
    env,
    config,
    backend,
    publishTelemetryCredential: async (id) => {
      opts.onIdentity?.(id);
      await writeAgentEventsAuth(secrets, id, env);
    },
    onReRegister: (fn) => {
      reRegister = fn;
    },
    running: latch.running,
  });

  return {
    stop: latch.stop,
    reRegister: () => reRegister?.() ?? Promise.resolve(null),
  };
}

/** In a cluster the identity persists through the Kubernetes Secret API — the chart mounts the container read-only, so a file write would EROFS and strand the identity. File store only for local runs. */
async function buildIdentityStore(
  config: IdentityStoreConfig,
): Promise<IdentityStore> {
  if (config.kind === "file") {
    return new FileIdentityStore(config.path);
  }

  return new KubeIdentityStore(
    kubeIdentitySecretsApi(config.namespace),
    config.name,
    config.key,
  );
}
