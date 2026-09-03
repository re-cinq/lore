/** Station execution backend (ADR-028): K8s (LoreTask CR, completion resolved later by the watcher) or Docker (local, completion set synchronously); `shared` never imports the K8s/Docker SDKs. */

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
  /** Set when this dispatch JOINED a run already working the same subject (`subjectKey`) instead of starting one — a joined task never completes on its own and must be settled by the caller. */
  joinedRun?: string;
  /** Synchronous backends (docker) resolve completion here; async (k8s) omit it and the watcher resolves it from the CR status later. */
  completion?: StationCompletion;
}

export interface StationBackend {
  launch(spec: LoreTaskSpec): Promise<StationLaunchResult>;
  /** Is the Station for `taskId` still actually running (probes the runtime, never the DB)? Returns `true` when unresolvable so the reaper falls back to its age window. */
  isActive(taskId: string): Promise<boolean>;
}

/** Deterministic Station ref for a task with no explicit `spec.name` — `loretask-<first 8 of taskId>`; the reaper re-derives it from the task id alone. */
export function defaultStationName(taskId: string): string {
  return `loretask-${taskId.substring(0, 8)}`;
}

export type StationBackendKind = "k8s" | "docker" | "inprocess";

/** Choose the Station backend: explicit `LORE_STATION_BACKEND` wins; else in-cluster → k8s, else docker. `inprocess` is an explicit, never-defaulted escape hatch. */
export function selectStationBackend(
  env: NodeJS.ProcessEnv = process.env,
): StationBackendKind {
  const explicit = env.LORE_STATION_BACKEND;

  if (explicit === "k8s" || explicit === "docker" || explicit === "inprocess") {
    return explicit;
  }

  return env.KUBERNETES_SERVICE_HOST ? "k8s" : "docker";
}
