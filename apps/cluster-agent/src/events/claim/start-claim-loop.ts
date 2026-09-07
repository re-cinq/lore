// Registrant shell: registers, then runs the claim loop launching Agent CRs. EVERY cluster-agent runs this (dispatch is pull-only, FR3); registration failure never crashes the process, it retries on the 30s→5m schedule.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { selectStationBackend } from "@re-cinq/lore-shared";
import { AgentCrBackend } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { KubeAgentApi } from "../../outbound/kube-agent-api.js";
import { kubeTokenProvisioner } from "../../outbound/deps.js";
import { KubeSecretKeyWriter } from "../../outbound/kube-token-provisioner.js";
import { writeAgentEventsAuth } from "./agent-events-secret.js";
import { claimIntervalMs, claimOnce, runClaimLoop } from "./claim-loop.js";
import { stopLatch } from "../../lib/stop-latch.js";
import {
  catalogSyncOnce,
  crdOptionsFromEnv,
  enforceCatalogProfile,
  runCatalogSyncLoop,
  syncIntervalMs,
  type CatalogTarget,
} from "../../work/catalog/catalog-sync-loop.js";
import { clusterDeps } from "../../outbound/deps.js";
import { KubeCatalogApi } from "../../outbound/kube-token-provisioner.js";
import {
  heartbeatIntervalMs,
  heartbeatOnce,
  runHeartbeatLoop,
} from "./heartbeat-loop.js";
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

/** Registers, and hands back the identity as a GETTER rather than a value: a 401 rotates it mid-run, and every loop must read the current one rather than the one it captured at startup. */
async function establishIdentity(opts: {
  config: RegistrationConfig;
  store: IdentityStore;
  publishTelemetryCredential: (id: ClusterAgentIdentity) => Promise<void>;
}): Promise<{
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
}> {
  const { config, store, publishTelemetryCredential } = opts;
  let current: ClusterAgentIdentity = await registerWithBackoff({
    config,
    store,
    sleep,
    publishTelemetryCredential,
  });

  console.log(
    `[cluster-agent] registered as ${config.name} (${current.id}), tags [${config.tags.join(", ")}] — claim loop starting`,
  );

  const reRegister = singleFlightReRegister({
    config,
    store,
    publishTelemetryCredential,
    adopt: (rotated) => {
      current = rotated;
    },
  });

  return { identity: () => current, reRegister };
}

/** The heartbeat rides BESIDE the claim loop, not inside it — an agent busy executing a long claim must still look alive. Detached deliberately: a crashed heartbeat is logged, never allowed to take the claim loop down with it. */
function startHeartbeat(opts: {
  env: NodeJS.ProcessEnv;
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  running: () => boolean;
}): void {
  void runHeartbeatLoop({
    beat: () =>
      heartbeatOnce({ apiUrl: opts.apiUrl, identity: opts.identity }),
    reRegister: opts.reRegister,
    sleep,
    intervalMs: heartbeatIntervalMs(opts.env),
    running: opts.running,
  }).catch((err) => {
    console.error("[cluster-agent] heartbeat loop crashed:", err);
  });
}

/** Bounded so a catalog that never syncs cannot hold the agent idle: a claim on a missing stationRef fails visibly and is handed back, which is a better failure than claiming nothing at all. */
async function awaitFirstCatalogSync(firstSync: Promise<unknown>): Promise<void> {
  await Promise.race([
    firstSync,
    sleep(FIRST_SYNC_TIMEOUT_MS).then(() => {
      console.warn(
        "[cluster-agent] first catalog sync has not completed — starting the claim loop anyway; a claim on a missing stationRef fails visibly and is handed back",
      );
    }),
  ]);
}

interface RegistrantOpts {
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
}

async function runRegistrant(opts: RegistrantOpts): Promise<void> {
  const {
    env,
    config,
    store,
    backend,
    publishTelemetryCredential,
    onReRegister,
    running,
  } = opts;
  const { identity, reRegister } = await establishIdentity({
    config,
    store,
    publishTelemetryCredential,
  });

  onReRegister(reRegister);

  const firstSync = startCatalogSync({
    env,
    config,
    identity,
    reRegister,
    running,
  });

  startHeartbeat({
    env,
    apiUrl: config.apiUrl,
    identity,
    reRegister,
    running,
  });

  await awaitFirstCatalogSync(firstSync);

  await runClaimLoop({
    claim: () =>
      claimOnce({
        apiUrl: config.apiUrl,
        identity,
        launch: (spec) => backend.launch(spec),
      }),
    reRegister,
    sleep,
    baseDelayMs: claimIntervalMs(env),
    running,
  });
}

/** Single-flight: the heartbeat and claim loops can 401 in the same window, so both callers await the same in-flight re-registration attempt. */
function singleFlightReRegister(opts: {
  config: RegistrationConfig;
  store: IdentityStore;
  publishTelemetryCredential: (id: ClusterAgentIdentity) => Promise<void>;
  adopt: (identity: ClusterAgentIdentity) => void;
}): () => Promise<ClusterAgentIdentity | null> {
  let inFlight: Promise<ClusterAgentIdentity | null> | null = null;

  return () =>
    (inFlight ??= registerOnce({
      config: opts.config,
      store: opts.store,
      publishTelemetryCredential: opts.publishTelemetryCredential,
    })
      .then((rotated) => {
        if (rotated) {
          opts.adopt(rotated);
        }

        return rotated;
      })
      .finally(() => {
        inFlight = null;
      }));
}

/** The catalog sync rides beside the claim loop and GATES its start — the first full-catalog snapshot must be able to resolve an Agent CR's stationRef. The returned promise settles on that first snapshot. */
function startCatalogSync(opts: {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  running: () => boolean;
}): Promise<void> {
  const { env, config, identity, reRegister, running } = opts;
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
          identity,
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

  return firstSync;
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
