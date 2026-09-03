// The agent-cr execution path (ADR-031 #688): routes a task to the Floor-side AssemblyLine when one is defined for its task type, else runs it as a SINGLE Agent CR (onboard/review/runbook); both halves ENQUEUE for a cluster-agent to claim (specs/running-stations-in-any-k8s-cluster FR3) — nothing here pushes a CR anymore. Only the LIFECYCLE differs: no graph means no walk, so the agent-watcher still resolves a single CR's completion.

import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
  AgentLister,
} from "@re-cinq/lore-shared";
import {
  agentCrName,
  isTaskAgentActive,
} from "@re-cinq/lore-shared/cluster/agent-backend.js";
import { resolveRequiredTags } from "@re-cinq/lore-shared/project/cluster-agents/required-tags.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { boundedStationRunInput } from "../assembly-run/floor-assembly-run.js";

/** A task type runs on the assembly line when a builtin assembly line is defined for it. */
export function shouldUseAssemblyLine(
  taskType: string,
  assemblyLineNames: ReadonlySet<string>,
): boolean {
  return assemblyLineNames.has(taskType);
}

// The node id a single-CR task's one visit is recorded under; names what the visit IS rather than the task type (blueprintName already carries that), since the claim matches on required_tags, which this id is the type half of.
const SINGLE_CR_NODE_ID = "agent";

/** Run rows a single-CR re-dispatch may converge on rather than opening a second. */
const OPEN_STATUSES = ["queued", "running"];

export interface AgentCrStationBackendDeps {
  assemblyLine: StationBackend;
  assemblyLineNames: ReadonlySet<string>;
  assemblyRuns: Pick<
    AssemblyRunsPort,
    "start" | "listForTask" | "ensureStationRun"
  >;
  agents: AgentLister;
  repoSettings: (repo: string) => Promise<Record<string, unknown> | null>;
}

export class AgentCrStationBackend implements StationBackend {
  private readonly assemblyLine: StationBackend;
  private readonly assemblyLineNames: ReadonlySet<string>;
  private readonly assemblyRuns: AgentCrStationBackendDeps["assemblyRuns"];
  private readonly agents: AgentLister;
  private readonly repoSettings: AgentCrStationBackendDeps["repoSettings"];

  constructor(deps: AgentCrStationBackendDeps) {
    this.assemblyLine = deps.assemblyLine;
    this.assemblyLineNames = deps.assemblyLineNames;
    this.assemblyRuns = deps.assemblyRuns;
    this.agents = deps.agents;
    this.repoSettings = deps.repoSettings;
  }

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    if (shouldUseAssemblyLine(spec.taskType, this.assemblyLineNames)) {
      return this.assemblyLine.launch(spec);
    }

    // Total coverage: single-CR tasks get a per-attempt run row too, so pipeline.assembly_runs is the complete execution history — a crash-recovery re-dispatch reuses the run it already opened, else it mints a phantom second row for one execution.
    const open = (await this.assemblyRuns.listForTask(spec.taskId)).find(
      (row) => OPEN_STATUSES.includes(row.status),
    );
    const assemblyRunId =
      open?.id ??
      (await this.assemblyRuns.start({
        blueprintName: spec.taskType,
        repo: spec.targetRepo,
        branch: spec.branch,
        taskId: spec.taskId,
        args: { description: spec.description },
      }));

    // The name the row records and the name the spec carries are the same value on purpose — a spelling drift wouldn't fail to compile, it would just never correlate, reading as a run nobody ever launched.
    const name = agentCrName(spec.taskId);
    // One call, not an insert plus an arm: ensureStationRun's unique key is what makes a re-dispatch converge, keeping the spec it was armed with rather than overwriting a pod already being built from the first.
    const { created } = await this.assemblyRuns.ensureStationRun({
      assemblyRunId,
      nodeId: SINGLE_CR_NODE_ID,
      iteration: 1,
      agentCrName: name,
      status: "queued",
      requiredTags: resolveRequiredTags(
        SINGLE_CR_NODE_ID,
        undefined,
        await this.repoSettings(spec.targetRepo),
      ),
      input: boundedStationRunInput({
        description: spec.description,
        prompt: spec.prompt,
        repo: spec.targetRepo,
        ref: spec.branch,
      }),
      dispatchSpec: { ...spec, name },
    });

    return { ref: name, launched: created };
  }

  // Probe the cluster's CRs by task-id label, which finds a single Agent and an assembly line's per-node Agents alike — so the reaper sees either path.
  isActive(taskId: string): Promise<boolean> {
    return isTaskAgentActive(this.agents, taskId);
  }
}
