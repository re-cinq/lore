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
  /**
   * Is the Station for `taskId` still actually running? Probes the real runtime
   * (Docker container / K8s LoreTask CR), never the DB. The feature-planning
   * reaper uses this to tell a live round from one whose container/pod died
   * (orphaned by a restart or crash). Conservative on the unknown: returns
   * `true` when the probe can't be resolved (docker/kube unreachable), so the
   * reaper falls back to its age window instead of killing a live round.
   */
  isActive(taskId: string): Promise<boolean>;
}

/**
 * Deterministic Station ref (container name on docker / CR name on k8s) for a
 * task that carries no explicit `spec.name` — `loretask-<first 8 of taskId>`.
 * Both backends mint this same name at launch, so the reaper can re-derive it
 * from the task id alone to probe whether the runtime is still up.
 */
export function defaultStationName(taskId: string): string {
  return `loretask-${taskId.substring(0, 8)}`;
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
