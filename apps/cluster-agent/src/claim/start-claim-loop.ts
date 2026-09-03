// Registrant shell: registers, then runs the claim loop launching Agent CRs. EVERY cluster-agent runs this (dispatch is pull-only, FR3); registration failure never crashes the process, it retries on the 30s→5m schedule.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { selectStationBackend } from "@re-cinq/lore-shared";
import { AgentCrBackend } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { KubeAgentApi } from "../kernel/kube-agent-api.js";
import { kubeTokenProvisioner } from "../kernel/deps.js";
import { KubeSecretKeyWriter } from "../kernel/kube-token-provisioner.js";
import { writeAgentEventsAuth } from "./agent-events-secret.js";
import {
  claimIntervalMs,
  claimOnce,
  runClaimLoop,
  stopLatch,
} from "./claim-loop.js";
import {
  catalogSyncOnce,
  crdOptionsFromEnv,
  enforceCatalogProfile,
  runCatalogSyncLoop,
  syncIntervalMs,
  type CatalogTarget,
} from "../catalog/catalog-sync-loop.js";
import { clusterDeps } from "../kernel/deps.js";
import { KubeCatalogApi } from "../kernel/kube-token-provisioner.js";
import {
  heartbeatIntervalMs,
  heartbeatOnce,
  runHeartbeatLoop,
} from "./heartbeat-loop.js";
import { FileIdentityStore, identityStoreConfig } from "./identity-store.js";
import type {
  ClusterAgentIdentity,
  IdentityStore,
  IdentityStoreConfig,
} from "./identity-store.js";
import {
  KubeIdentityStore,
  kubeIdentitySecretsApi,
} from "./kube-identity-store.js";
import {
  registerOnce,
  registerWithBackoff,
  registrationConfig,
} from "./registration.js";
import type { RegistrationConfig } from "./registration.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** How long the claim loop's start waits on the first catalog sync — long enough for a snapshot, short enough a wedged API can't block claiming forever. */
const FIRST_SYNC_TIMEOUT_MS = 120_000;

async function runRegistrant(opts: {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  store: IdentityStore;
  backend: AgentCrBackend;
  /** Publishes each newly-minted per-agent token to the run pods' Secret, so their telemetry sink can authenticate as this cluster. */
  publishTelemetryCredential: (id: ClusterAgentIdentity) => Promise<void>;
  /** Hands the single-flight re-registration to the composition root, so the Agent-CR reporter can rotate on 401 like the other loops. */
  onReRegister: (reRegister: () => Promise<unknown>) => void;
  /** Stops both loops; a shutdown flips it before the queue drains. */
  running: () => boolean;
}): Promise<void> {
  const {
    env,
    config,
    store,
    backend,
    publishTelemetryCredential,
    onReRegister,
    running,
  } = opts;
  let identity: ClusterAgentIdentity = await registerWithBackoff({
    config,
    store,
    sleep,
    publishTelemetryCredential,
  });

  console.log(
    `[cluster-agent] registered as ${config.name} (${identity.id}), tags [${config.tags.join(", ")}] — claim loop starting`,
  );

  // Single-flight: the heartbeat and claim loops can 401 in the same window, so both callers await the same in-flight re-registration attempt.
  let reRegistration: Promise<ClusterAgentIdentity | null> | null = null;
  const reRegister = (): Promise<ClusterAgentIdentity | null> =>
    (reRegistration ??= registerOnce({
      config,
      store,
      publishTelemetryCredential,
    })
      .then((rotated) => {
        if (rotated) {
          identity = rotated;
        }

        return rotated;
      })
      .finally(() => {
        reRegistration = null;
      }));

  onReRegister(reRegister);

  // The catalog sync rides beside the claim loop and GATES its start — the first full-catalog snapshot must resolve an Agent CR's stationRef, bounded by FIRST_SYNC_TIMEOUT_MS so a wedged API cannot block claims forever.
  const kubeCatalog = new KubeCatalogApi();
  const catalog: CatalogTarget = {
    applyPair: (pair) => clusterDeps().catalog.applyPair(pair),
    deletePair: (name) => clusterDeps().catalog.deletePair(name),
    getAgentDefinition: (name) => kubeCatalog.getAgentDefinition(name),
  };
  let resolveFirstSync = (): void => {};
  const firstSync = new Promise<void>((resolve) => {
    resolveFirstSync = resolve;
  });

  void runCatalogSyncLoop({
    sync: (ack, snapshot) =>
      catalogSyncOnce(
        {
          apiUrl: config.apiUrl,
          identity: () => identity,
          catalog,
          crdOptions: crdOptionsFromEnv(env),
          ownSeeded: env.LORE_CATALOG_SYNC_OWN_SEEDED === "1",
        },
        ack,
        snapshot,
      ),
    reRegister,
    sleep,
    baseDelayMs: syncIntervalMs(env),
    running,
    onFirstSync: () => resolveFirstSync(),
  }).catch((err) => {
    console.error("[cluster-agent] catalog sync loop crashed:", err);
  });

  // The heartbeat rides beside the claim loop, not inside it — an agent busy executing a long claim must still look alive.
  void runHeartbeatLoop({
    beat: () =>
      heartbeatOnce({ apiUrl: config.apiUrl, identity: () => identity }),
    reRegister,
    sleep,
    intervalMs: heartbeatIntervalMs(env),
    running,
  }).catch((err) => {
    console.error("[cluster-agent] heartbeat loop crashed:", err);
  });

  await Promise.race([
    firstSync,
    sleep(FIRST_SYNC_TIMEOUT_MS).then(() => {
      console.warn(
        "[cluster-agent] first catalog sync has not completed — starting the claim loop anyway; a claim on a missing stationRef fails visibly and is handed back",
      );
    }),
  ]);

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
    running,
  });
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

/** Start registration + the claim loop. Throws when the registration triple is unset or there is no cluster to launch into — both are misconfigurations, not modes. */
export function startClaimLoop(
  env: NodeJS.ProcessEnv,
  opts: StartClaimLoopOpts = {},
): ClaimLoopHandle {
  let reRegister: (() => Promise<unknown>) | null = null;
  const latch = stopLatch();
  const handle: ClaimLoopHandle = {
    stop: latch.stop,
    reRegister: () => reRegister?.() ?? Promise.resolve(null),
  };

  // A cluster-agent IS its cluster's Kubernetes client — without one it can neither launch nor watch, so this refuses to boot rather than run quieter.
  enforceTrue(
    selectStationBackend(env) === "k8s",
    Error,
    "cluster-agent cannot start: the station backend is not k8s. This process launches claimed runs as Agent CRs — set LORE_STATION_BACKEND=k8s and point LORE_KUBECONFIG at the cluster.",
  );
  const config = registrationConfig(env);

  // A full cluster missing its per-cluster render values must refuse to boot — two unset env vars produced pods that died at boot cluster-wide on 2026-09-01.
  enforceCatalogProfile(env);
  // Decided synchronously — a Secret store missing its namespace used to land silently in the catch below: one log line, pod Ready, nothing ever registered.
  const storeConfig = identityStoreConfig(env);

  const backend = new AgentCrBackend(
    new KubeAgentApi(),
    kubeTokenProvisioner(),
  );

  // The same Secret writer the per-task GitHub provisioner uses — a merge into `agent-secrets`, not a replace, since both write to it.
  const secrets = new KubeSecretKeyWriter();

  void buildIdentityStore(storeConfig)
    .then((store) =>
      runRegistrant({
        env,
        config,
        store,
        backend,
        publishTelemetryCredential: async (id) => {
          opts.onIdentity?.(id);
          await writeAgentEventsAuth(secrets, id, env);
        },
        onReRegister: (fn) => {
          reRegister = fn;
        },
        running: latch.running,
      }),
    )
    .catch((err) => {
      // Unreachable by design (register + claim never throw), but a defect here must surface as a log, not an unhandled rejection.
      console.error(
        "[cluster-agent] claim loop crashed — this agent will not register or claim until restarted:",
        err,
      );
    });

  return handle;
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
