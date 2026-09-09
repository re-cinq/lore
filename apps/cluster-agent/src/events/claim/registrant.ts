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

// What both side loops need: where to talk, who this cluster is, and whether the process is still up. One shape because they are started together and stopped together.
interface SideLoopOpts {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
  running: () => boolean;
}

/** Start registration + the claim loop. Throws when the registration triple is unset or there is no cluster to launch into — both are misconfigurations, not modes. */
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
    claim: () => claimOnce(claimDeps(config, identity, backend)),
    reRegister,
    sleep,
    baseDelayMs: claimIntervalMs(env),
    running,
  });
}

/** Registers, and hands back the identity as a GETTER rather than a value: a 401 rotates it mid-run, and every loop must read the current one rather than the one it captured at startup. */
async function establishIdentity(
  opts: Pick<RegistrantOpts, "config" | "store" | "publishTelemetryCredential">,
): Promise<{
  identity: () => ClusterAgentIdentity;
  reRegister: () => Promise<ClusterAgentIdentity | null>;
}> {
  const { config, store, publishTelemetryCredential } = opts;
  let current = await registerAndAnnounce(opts);
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

// The first registration, with the line that says this cluster is now claiming. Announced here rather than by the caller because the id only exists once registration has succeeded.
async function registerAndAnnounce(
  opts: Pick<RegistrantOpts, "config" | "store" | "publishTelemetryCredential">,
): Promise<ClusterAgentIdentity> {
  const identity = await registerWithBackoff({
    config: opts.config,
    store: opts.store,
    sleep,
    publishTelemetryCredential: opts.publishTelemetryCredential,
  });

  const { name, tags } = opts.config;

  console.log(
    `[cluster-agent] registered as ${name} (${identity.id}), tags [${tags.join(", ")}] — claim loop starting`,
  );

  return identity;
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
    (inFlight ??= attemptReRegister(opts).finally(() => {
      inFlight = null;
    }));
}

// One re-registration, adopting the rotated identity if it succeeded. Adopting here rather than at the call site is what makes the getter every loop reads point at the new credential the moment it exists.
function attemptReRegister(opts: {
  config: RegistrationConfig;
  store: IdentityStore;
  publishTelemetryCredential: (id: ClusterAgentIdentity) => Promise<void>;
  adopt: (identity: ClusterAgentIdentity) => void;
}): Promise<ClusterAgentIdentity | null> {
  return registerOnce({
    config: opts.config,
    store: opts.store,
    publishTelemetryCredential: opts.publishTelemetryCredential,
  }).then((rotated) => {
    if (rotated) {
      opts.adopt(rotated);
    }

    return rotated;
  });
}

/** The two loops that run BESIDE the claim loop: the catalog sync, whose first snapshot gates the start, and the heartbeat, which must keep reporting while a long claim executes. Returns the first-sync promise the caller waits on. */
function startSideLoops(opts: SideLoopOpts): Promise<void> {
  const firstSync = startCatalogSync(opts);

  startHeartbeat({
    env: opts.env,
    apiUrl: opts.config.apiUrl,
    identity: opts.identity,
    reRegister: opts.reRegister,
    running: opts.running,
  });

  return firstSync;
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

/** The catalog sync rides beside the claim loop and GATES its start — the first full-catalog snapshot must be able to resolve an Agent CR's stationRef. The returned promise settles on that first snapshot. */
function startCatalogSync(opts: SideLoopOpts): Promise<void> {
  const { env, config, identity, reRegister, running } = opts;
  const catalog = catalogTarget();
  const { firstSync, resolveFirstSync } = firstSyncLatch();

  void runCatalogSyncLoop({
    sync: (ack, mode) =>
      catalogSyncOnce(syncOptions(env, config, identity, catalog), ack, mode),
    reRegister,
    sleep,
    baseDelayMs: syncIntervalMs(env),
    running,
    onFirstSync: resolveFirstSync,
  }).catch(reportSyncCrash);

  return firstSync;
}

/** What a catalog sync writes through. Reads go direct to Kubernetes while writes go via clusterDeps, because a paired write is atomic there and a read never needs to be. */
function catalogTarget(): CatalogTarget {
  const kubeCatalog = new KubeCatalogApi();

  return {
    applyPair: (pair) => clusterDeps().catalog.applyPair(pair),
    deletePair: (name) => clusterDeps().catalog.deletePair(name),
    getAgentDefinition: (name) => kubeCatalog.getAgentDefinition(name),
  };
}

// A promise that settles on the first completed catalog sync. The claim loop waits on it: a claim that lands before the first snapshot cannot resolve an Agent CR's stationRef.
function firstSyncLatch(): {
  firstSync: Promise<void>;
  resolveFirstSync: () => void;
} {
  let resolveFirstSync = (): void => {};
  const firstSync = new Promise<void>((resolve) => {
    resolveFirstSync = resolve;
  });

  return { firstSync, resolveFirstSync: () => resolveFirstSync() };
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

// The sync loop died. Logged, not rethrown: it runs beside the claim loop, and a cluster that can still claim work is more useful than one that exits because its catalog went stale.
function reportSyncCrash(err: unknown): void {
  console.error("[cluster-agent] catalog sync loop crashed:", err);
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

// What one claim needs: where to ask, who is asking, and where the work runs. `identity` stays a getter — a 401 rotates it mid-run, and a captured value would keep claiming with a credential the API no longer accepts.
function claimDeps(
  config: RegistrationConfig,
  identity: () => ClusterAgentIdentity,
  backend: RegistrantOpts["backend"],
): Parameters<typeof claimOnce>[0] {
  return {
    apiUrl: config.apiUrl,
    identity,
    launch: (spec) => backend.launch(spec),
  };
}
