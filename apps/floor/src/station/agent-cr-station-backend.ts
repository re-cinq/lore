// The agent-cr execution path (ADR-031 #688): within the cutover's `agent-cr` backend,
// route a task to the Floor-side workflow GRAPH when a workflow is defined for its task
// type (implementation / general / gap-fill / …), else run it as a SINGLE Agent (one CR
// does the whole task — onboard / review / runbook have no workflow). Pure routing; both
// backends are injected.

import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";

/** A task type runs on the graph when a builtin workflow is defined for it. */
export function shouldUseGraph(taskType: string, workflowNames: ReadonlySet<string>): boolean {
  return workflowNames.has(taskType);
}

export class AgentCrStationBackend implements StationBackend {
  constructor(
    private readonly graph: StationBackend,
    private readonly singleAgent: StationBackend,
    private readonly workflowNames: ReadonlySet<string>,
  ) {}

  launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const backend = shouldUseGraph(spec.taskType, this.workflowNames) ? this.graph : this.singleAgent;
    return backend.launch(spec);
  }

  /** Probe the single-Agent backend, whose task-id label query finds both the single
   *  Agent and the graph's per-node Agents — so the reaper sees either path. */
  isActive(taskId: string): Promise<boolean> {
    return this.singleAgent.isActive(taskId);
  }
}
