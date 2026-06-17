/**
 * Station execution backend (ADR-028). A "Station" runs one task in the
 * claude-runner container. Two backends implement this port:
 *  - K8s   (GKE cluster): creates a LoreTask CR; completion is resolved LATER
 *          by the loretask-watcher reading the CR status → `completion` omitted.
 *  - Docker (local dev): `docker run` the same image and wait → `completion` set
 *          synchronously off the container exit.
 * The backend is chosen by {@link selectStationBackend}. `shared` never imports
 * the K8s/Docker SDKs — the runtime injects an adapter.
 */

import type { LoreTaskSpec } from "./k8s-port.js";

export interface StationCompletion {
  exitCode: number;
  changedFiles: number;
  output: string;
  reviewResult?: string;
}

export interface StationLaunchResult {
  /** CR name (k8s) or container id/name (docker). */
  ref: string;
  /** false = already exists (k8s 409) or not started. */
  launched: boolean;
  /** Synchronous backends (docker) resolve completion here; async (k8s) omit it
   *  and the watcher resolves completion from the CR status later. */
  completion?: StationCompletion;
}

export interface StationBackend {
  launch(spec: LoreTaskSpec): Promise<StationLaunchResult>;
}

export type StationBackendKind = "k8s" | "docker" | "inprocess";

/**
 * Choose the Station backend: explicit `LORE_STATION_BACKEND` wins; otherwise
 * default by context — in-cluster (`KUBERNETES_SERVICE_HOST` present) → k8s,
 * else docker. `inprocess` is an explicit, never-defaulted escape hatch (the
 * worker runs planning/finalize in-process; other cluster tasks still need a
 * container, so callers treat inprocess as docker for those).
 */
export function selectStationBackend(
  env: NodeJS.ProcessEnv = process.env,
): StationBackendKind {
  const explicit = env.LORE_STATION_BACKEND;
  if (explicit === "k8s" || explicit === "docker" || explicit === "inprocess") {
    return explicit;
  }
  return env.KUBERNETES_SERVICE_HOST ? "k8s" : "docker";
}
