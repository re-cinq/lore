// Cutover routing StationBackend (ADR-031, #688). Holds both execution backends and
// picks per task at launch, so the graded rollout (per-repo setting + percentage) is
// honored at dispatch — where the task id (the rollout bucket) is known. Pure delegation;
// the decision is the injected `route` (executionBackendForTask).

import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";
import type { ExecutionBackend } from "./execution-backend.js";

export class RoutingStationBackend implements StationBackend {
  constructor(
    private readonly backends: Record<ExecutionBackend, StationBackend>,
    private readonly route: (taskId: string) => ExecutionBackend,
  ) {}

  launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    return this.backends[this.route(spec.taskId)].launch(spec);
  }

  isActive(taskId: string): Promise<boolean> {
    return this.backends[this.route(taskId)].isActive(taskId);
  }
}
