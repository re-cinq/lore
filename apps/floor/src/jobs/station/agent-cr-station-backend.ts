// The agent-cr execution path (ADR-031 #688): within the cutover's `agent-cr` backend,
// route a task to the Floor-side AssemblyLine when an assembly line is defined for its task
// type (implementation / general / gap-fill / …), else run it as a SINGLE Agent (one CR
// does the whole task — onboard / review / runbook have no assembly line). Pure routing; both
// backends are injected.

import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";

/** A task type runs on the assembly line when a builtin assembly line is defined for it. */
export function shouldUseAssemblyLine(
  taskType: string,
  assemblyLineNames: ReadonlySet<string>,
): boolean {
  return assemblyLineNames.has(taskType);
}

export class AgentCrStationBackend implements StationBackend {
  constructor(
    private readonly assemblyLine: StationBackend,
    private readonly singleAgent: StationBackend,
    private readonly assemblyLineNames: ReadonlySet<string>,
  ) {}

  launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    if (shouldUseAssemblyLine(spec.taskType, this.assemblyLineNames)) {
      return this.assemblyLine.launch(spec);
    }

    return this.singleAgent.launch(spec);
  }

  /** Probe the single-Agent backend, whose task-id label query finds both the single
   *  Agent and the assembly line's per-node Agents — so the reaper sees either path. */
  isActive(taskId: string): Promise<boolean> {
    return this.singleAgent.isActive(taskId);
  }
}
