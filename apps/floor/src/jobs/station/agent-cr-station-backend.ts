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
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";

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
    private readonly assemblyLines: Pick<
      AssemblyLinesPort,
      "start" | "listForTask"
    >,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    if (shouldUseAssemblyLine(spec.taskType, this.assemblyLineNames)) {
      return this.assemblyLine.launch(spec);
    }

    // Total coverage: single-CR tasks get a per-attempt run row too, so
    // pipeline.assembly_lines is the complete execution history. The start
    // handler marks it running; the agent-watcher finishes it at CR terminal.
    // Single CRs are keyed on taskId (not a per-attempt id), so a crash-recovery
    // re-dispatch reuses the same CR — skip start() when an open row already
    // exists, else that re-dispatch mints a phantom second row for one execution.
    const alreadyOpen = (
      await this.assemblyLines.listForTask(spec.taskId)
    ).some((row) => row.status === "queued" || row.status === "running");

    if (!alreadyOpen) {
      await this.assemblyLines.start({
        definitionName: spec.taskType,
        repo: spec.targetRepo,
        branch: spec.branch,
        taskId: spec.taskId,
        args: { description: spec.description },
      });
    }

    return this.singleAgent.launch(spec);
  }

  /** Probe the single-Agent backend, whose task-id label query finds both the single
   *  Agent and the assembly line's per-node Agents — so the reaper sees either path. */
  isActive(taskId: string): Promise<boolean> {
    return this.singleAgent.isActive(taskId);
  }
}
