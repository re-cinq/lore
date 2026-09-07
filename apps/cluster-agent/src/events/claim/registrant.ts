// What a REGISTERED agent does; how a process becomes one is start-claim-loop.ts.

import { KubeCatalogApi } from "../../outbound/kube-catalog-api.js";
import { AgentCrBackend } from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { claimIntervalMs, claimOnce, runClaimLoop } from "./claim-loop.js";
import {
  catalogSyncOnce,
  crdOptionsFromEnv,
  runCatalogSyncLoop,
  syncIntervalMs,
  type CatalogTarget,
} from "../../work/catalog/catalog-sync-loop.js";
import { clusterDeps } from "../../outbound/deps.js";
import {
  heartbeatIntervalMs,
  heartbeatOnce,
  runHeartbeatLoop,
} from "./heartbeat-loop.js";
import type {
  ClusterAgentIdentity,
  IdentityStore,
} from "../../domain/identity.js";
import { registerOnce, registerWithBackoff } from "./registration.js";
import type { RegistrationConfig } from "./registration.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** How long the claim loop's start waits on the first catalog sync — long enough for a snapshot, short enough a wedged API cannot block claiming forever. */
const FIRST_SYNC_TIMEOUT_MS = 120_000;

/** Registers, and hands back the identity as a GETTER rather than a value: a 401 rotates it mid-run, and every loop must read the current one rather than the one it captured at startup. */
async function establishIdentity(
  opts: Pick<RegistrantOpts, "config" | "store" | "publishTelemetryCredential">,
): Promise<{
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
    beat: () => heartbeatOnce({ apiUrl: opts.apiUrl, identity: opts.identity }),
    reRegister: opts.reRegister,
    sleep,
    intervalMs: heartbeatIntervalMs(opts.env),
    running: opts.running,
  }).catch((err) => {
    console.error("[cluster-agent] heartbeat loop crashed:", err);
  });
}

/** Bounded so a catalog that never syncs cannot hold the agent idle: a claim on a missing stationRef fails visibly and is handed back, which is a better failure than claiming nothing at all. */
async function awaitFirstCatalogSync(
  firstSync: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    firstSync,
    sleep(FIRST_SYNC_TIMEOUT_MS).then(() => {
      console.warn(
        "[cluster-agent] first catalog sync has not completed — starting the claim loop anyway; a claim on a missing stationRef fails visibly and is handed back",
      );
    }),
  ]);
}

export interface RegistrantOpts {
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

/** The two loops that run BESIDE the claim loop: the catalog sync, whose first snapshot gates the start, and the heartbeat, which must keep reporting while a long claim executes. Returns the first-sync promise the caller waits on. */
function startSideLoops(opts: {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  running: () => boolean;
}): Promise<void> {
  const { env, config, identity, reRegister, running } = opts;
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

  return firstSync;
}

export async function runRegistrant(opts: RegistrantOpts): Promise<void> {
  const { env, config, backend, onReRegister, running } = opts;
  const { identity, reRegister } = await establishIdentity(opts);

  onReRegister(reRegister);

  const firstSync = startSideLoops({
    env,
    config,
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
/** What a catalog sync writes through. Reads go direct to Kubernetes while writes go via clusterDeps, because a paired write is atomic there and a read never needs to be. */
function catalogTarget(): CatalogTarget {
  const kubeCatalog = new KubeCatalogApi();

  return {
    applyPair: (pair) => clusterDeps().catalog.applyPair(pair),
    deletePair: (name) => clusterDeps().catalog.deletePair(name),
    getAgentDefinition: (name) => kubeCatalog.getAgentDefinition(name),
  };
}

/** `ownSeeded` decides whether this cluster maintains the builtin recipes itself; a satellite leaves them to the platform's own agent. */
function syncOptions(
  env: NodeJS.ProcessEnv,
  config: RegistrationConfig,
  identity: () => ClusterAgentIdentity,
  catalog: CatalogTarget,
): Parameters<typeof catalogSyncOnce>[0] {
  return {
    apiUrl: config.apiUrl,
    identity,
    catalog,
    crdOptions: crdOptionsFromEnv(env),
    ownSeeded: env.LORE_CATALOG_SYNC_OWN_SEEDED === "1",
  };
}

function startCatalogSync(opts: {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  running: () => boolean;
}): Promise<void> {
  const { env, config, identity, reRegister, running } = opts;
  const catalog = catalogTarget();
  let resolveFirstSync = (): void => {};
  const firstSync = new Promise<void>((resolve) => {
    resolveFirstSync = resolve;
  });

  void runCatalogSyncLoop({
    sync: (ack, snapshot) =>
      catalogSyncOnce(
        syncOptions(env, config, identity, catalog),
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

/** Start registration + the claim loop. Throws when the registration triple is unset or there is no cluster to launch into — both are misconfigurations, not modes. */
