// Cutover routing StationBackend (ADR-031, #688). Holds both execution backends and
// picks via the injected `route` (executionBackendForTask) — a binary per-repo decision,
// re-evaluated at both launch and isActive so the reaper probes the same backend the task
// launched on. Pure delegation.

import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";
import type { ExecutionBackend } from "./execution-backend.js";

export class RoutingStationBackend implements StationBackend {
  constructor(
    private readonly backends: Record<ExecutionBackend, StationBackend>,
    private readonly route: () => ExecutionBackend,
  ) {}

  launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    return this.backends[this.route()].launch(spec);
  }

  isActive(taskId: string): Promise<boolean> {
    return this.backends[this.route()].isActive(taskId);
  }
}
