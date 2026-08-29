// The agent-cr execution path (ADR-031 #688): within the cutover's `agent-cr` backend,
// route a task to the Floor-side AssemblyLine when an assembly line is defined for its task
// type (implementation / general / gap-fill / …), else run it as a SINGLE Agent (one CR
// does the whole task — onboard / review / runbook have no assembly line).
//
// Both halves now reach a cluster the same way: they ENQUEUE. The line's walk parks
// each node `queued` for a cluster-agent to claim (specs/running-stations-in-any-k8s-cluster
// FR3); this file does the same for the one visit a single-CR task makes. Nothing
// here pushes a CR — the last inbound dispatch route is gone, and a task type
// without a YAML file is no longer a task type dispatched by a different mechanism.
//
// What stays different is the LIFECYCLE, not the transport: no graph means no walk,
// so the agent-watcher still resolves a single CR's completion and closes its rows.

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

/**
 * The node id a single-CR task's one visit is recorded under.
 *
 * It names what the visit IS rather than borrowing the task type, because the
 * row's `blueprintName` already carries that — and because the claim matches on
 * `required_tags`, which this id is the type half of.
 */
const SINGLE_CR_NODE_ID = "agent";

/** Run rows a single-CR re-dispatch may converge on rather than opening a second. */
const OPEN_STATUSES = ["queued", "running"];

export class AgentCrStationBackend implements StationBackend {
  constructor(
    private readonly assemblyLine: StationBackend,
    private readonly assemblyLineNames: ReadonlySet<string>,
    private readonly assemblyRuns: Pick<
      AssemblyRunsPort,
      "start" | "listForTask" | "ensureStationRun"
    >,
    private readonly agents: AgentLister,
    private readonly repoSettings: (
      repo: string,
    ) => Promise<Record<string, unknown> | null>,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    if (shouldUseAssemblyLine(spec.taskType, this.assemblyLineNames)) {
      return this.assemblyLine.launch(spec);
    }

    // Total coverage: single-CR tasks get a per-attempt run row too, so
    // pipeline.assembly_runs is the complete execution history. The start
    // handler marks it running; the agent-watcher finishes it at CR terminal.
    // A crash-recovery re-dispatch reuses the run it already opened, else that
    // re-dispatch mints a phantom second row for one execution.
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

    // The name the row records and the name the spec carries are the same value
    // on purpose: the claiming cluster creates the CR under the spec's name, and
    // both the watch's terminal report and the reconcile pass find it again by
    // the row's. Two spellings would not fail to compile — they would just never
    // correlate, which reads as a run nobody ever launched.
    const name = agentCrName(spec.taskId);
    // One call, not an insert plus an arm: `ensureStationRun` already carries the
    // dispatch spec, and its unique key is what makes a re-dispatch converge —
    // a converged row keeps the spec it was armed with rather than having a
    // second one written over the pod already being built from the first.
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

  /** Probe the cluster's CRs by task-id label, which finds a single Agent and an
   *  assembly line's per-node Agents alike — so the reaper sees either path. */
  isActive(taskId: string): Promise<boolean> {
    return isTaskAgentActive(this.agents, taskId);
  }
}
