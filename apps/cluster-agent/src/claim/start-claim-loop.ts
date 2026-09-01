/**
 * The cluster-agent's registrant shell: register with the Lore API, then run the
 * claim loop, launching claimed specs as Agent CRs in this cluster through the
 * same local adapters the read routes use — no HTTP loopback.
 *
 * EVERY cluster-agent runs this, the central one included. Dispatch is pull-only
 * (FR3): the Floor parks each pod node `queued` and a registered agent's claim is
 * what turns it into a pod. An agent that did not register would therefore serve
 * its read routes perfectly while the queue it exists to drain went nowhere — so
 * the registration triple is required at boot (registrationConfig throws) rather
 * than switching a mode.
 *
 * Like the k8s watch, this file is the CONNECTION; every decision it wires
 * (registration, backoff, claim ticks) lives in the injectable modules beside it
 * and tests without a cluster. Registration FAILURE still never crashes the
 * process — the read routes and the watch keep serving while boot retries on the
 * 30s→5m schedule.
 */

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

/** How long the claim loop's start waits on the first catalog sync before
 *  proceeding without it — long enough for a snapshot to land, short enough
 *  that a wedged API cannot keep a whole cluster from ever claiming. */
const FIRST_SYNC_TIMEOUT_MS = 120_000;

async function runRegistrant(opts: {
  env: NodeJS.ProcessEnv;
  config: RegistrationConfig;
  store: IdentityStore;
  backend: AgentCrBackend;
  /** Publishes each newly-minted per-agent token to the run pods' Secret, so
   *  their telemetry sink can authenticate as this cluster. */
  publishTelemetryCredential: (id: ClusterAgentIdentity) => Promise<void>;
  /** Hands the single-flight re-registration to the composition root, so the
   *  Agent-CR reporter can rotate the credential on a 401 the same way the
   *  claim and heartbeat loops do. */
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

  // Single-flight: the heartbeat and claim loops can 401 in the same window,
  // and two registrations racing each other is two round trips and two writes
  // to answer one question. Both callers await the same in-flight attempt.
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

  // The catalog sync rides beside the claim loop too, and GATES its start:
  // an Agent CR's stationRef must resolve in this cluster, and a fresh
  // agent's first sync is the full-catalog snapshot that guarantees it — the
  // replacement for the Helm catalog-seed hook's deploy-ordering guarantee.
  // Bounded: an API outage that stalls the first sync would stall claims for
  // the same reason, so after the timeout the claim loop starts anyway (a
  // claim whose stationRef is missing fails visibly and is handed back).
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
    sync: (ack) =>
      catalogSyncOnce(
        {
          apiUrl: config.apiUrl,
          identity: () => identity,
          catalog,
          crdOptions: crdOptionsFromEnv(env),
          ownSeeded: env.LORE_CATALOG_SYNC_OWN_SEEDED === "1",
        },
        ack,
      ),
    reRegister,
    sleep,
    baseDelayMs: syncIntervalMs(env),
    running,
    onFirstSync: () => resolveFirstSync(),
  }).catch((err) => {
    console.error("[cluster-agent] catalog sync loop crashed:", err);
  });

  // The heartbeat rides beside the claim loop, not inside it: an agent busy
  // executing a long claim must still look alive.
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
  /** Called with the identity after EVERY successful registration, including
   *  a rotation. The composition root uses it to keep the event reporter's
   *  credential current — an agent with no bus-wide token reports with this
   *  one instead. */
  onIdentity?: (identity: ClusterAgentIdentity) => void;
}

export interface ClaimLoopHandle {
  /** Stop claiming. A claim that lands during a drain is a visit recorded as
   *  claimed by an agent that is about to exit mid-launch, so the shutdown
   *  flips this before it waits for anything else. */
  stop: () => void;
  /** Rotates the per-agent token through the single-flight re-registration.
   *  Resolves null until this agent has registered once — a 401 before that is
   *  not a rotation, and the caller's plain retry is all there is to do. */
  reRegister: () => Promise<unknown>;
}

/**
 * Start registration + the claim loop. Throws when the registration triple is
 * unset, and enforces that there is a cluster to launch into: both are
 * misconfigurations of the one mode this process has, not modes of their own.
 */
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

  // A cluster-agent IS its cluster's Kubernetes client. Without one it can
  // neither launch a claim nor watch what it launched, so this is a refusal to
  // boot rather than a quieter agent. In-cluster the selector resolves `k8s`
  // from KUBERNETES_SERVICE_HOST on its own; only a local run has to say so.
  enforceTrue(
    selectStationBackend(env) === "k8s",
    Error,
    "cluster-agent cannot start: the station backend is not k8s. This process launches claimed runs as Agent CRs — set LORE_STATION_BACKEND=k8s and point LORE_KUBECONFIG at the cluster.",
  );
  const config = registrationConfig(env);
  // Decided here, synchronously, for the same reason the triple above is: a
  // Secret store missing its namespace used to land in the catch below — one
  // log line, pod Ready, nothing ever registered.
  const storeConfig = identityStoreConfig(env);

  const backend = new AgentCrBackend(
    new KubeAgentApi(),
    kubeTokenProvisioner(),
  );

  // The same Secret writer the per-task GitHub provisioner uses — a merge into
  // `agent-secrets`, not a replace, because both write to it.
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
      // Unreachable by design (register + claim never throw), but a defect here
      // must surface as a log, not an unhandled rejection killing the process.
      console.error(
        "[cluster-agent] claim loop crashed — this agent will not register or claim until restarted:",
        err,
      );
    });

  return handle;
}

/** In a cluster the identity persists through the Kubernetes Secret API — the
 *  chart mounts the container read-only, so a file write would EROFS on the
 *  very first save and strand the minted identity (registered on the server,
 *  persisted nowhere → 409 restart loop). File store only for local runs. */
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
