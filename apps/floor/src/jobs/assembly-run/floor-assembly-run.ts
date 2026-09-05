// Floor-side assembly-line node specs (ADR-031 D4): pure spec-building core the event-driven walk (advance.ts) uses.

import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { serializeStationInput } from "@re-cinq/lore-shared/station-input.js";
import { builtinStationName } from "@re-cinq/lore-assembly-lines";
import { truncateForStorage } from "../lib/truncate-for-storage.js";
import type { StationRunInput } from "@re-cinq/lore-shared/models/station-run.js";
import {
  ASSEMBLY_RUN_ID_LABEL,
  LEGACY_ASSEMBLY_LINE_ID_LABEL,
  NODE_ID_LABEL,
  NODE_ITERATION_LABEL,
  STATION_RUN_ID_LABEL,
} from "@re-cinq/lore-shared/project/events/agent-cr-labels.js";

export interface FloorAssemblyRunTask {
  taskId: string;
  /** Backing pipeline.tasks row id, null for task-less lines (code-review) — a synthetic id would violate task_leases_task_fk. */
  pipelineTaskId: string | null;
  /** Per-attempt id (pipeline.assembly_runs) — CR names key on this, not the task. */
  assemblyLineId: string;
  taskType: string;
  description: string;
  targetRepo: string;
  branch: string;
  /** String/number entries thread into a station's params (e.g. comment-triage's comment_body/in_reply_to_id/pr_number). */
  args?: Record<string, unknown>;
}

/** Distinct Agent CR name per (attempt, node, iteration) so revisits get a fresh pod, not a 409-reuse; the 12-hex prefix also doubles as the telemetry correlation key (#907). */
export function nodeAgentName(
  assemblyLineId: string,
  nodeId: string,
  iteration = 1,
): string {
  const base = `${assemblyLineId.substring(0, 12)}-${nodeId}`;

  return iteration > 1 ? `${base}-${iteration}` : base;
}

/** These labels are a contract with the event-router (which reads them off a terminal CR), so they live in shared; re-exported for this module's existing callers. */
export {
  ASSEMBLY_RUN_ID_LABEL,
  LEGACY_ASSEMBLY_LINE_ID_LABEL,
  NODE_ID_LABEL,
  NODE_ITERATION_LABEL,
  STATION_RUN_ID_LABEL,
};

function nodeLabels(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  iteration: number,
  stationRunId?: string,
): Record<string, string> {
  return {
    [ASSEMBLY_RUN_ID_LABEL]: task.assemblyLineId,
    [NODE_ID_LABEL]: node.id,
    [NODE_ITERATION_LABEL]: String(iteration),
    // In the spec builder so every dispatch path carries it — the reaper's relaunch once built this spec without it.
    ...(stationRunId ? { [STATION_RUN_ID_LABEL]: stationRunId } : {}),
  };
}

/** The git ref a node's pod checks out: `args.ref` when the branch is only a lease key (ingest lines), else the branch. */
function cloneRef(task: FloorAssemblyRunTask): string {
  const ref = task.args?.ref;

  return typeof ref === "string" && ref.length > 0 ? ref : task.branch;
}

// Line args (string/number) ride into params so a station reads its input without a DB round-trip.
function addLineArgParams(
  params: Record<string, string>,
  args: Record<string, unknown> | undefined,
): void {
  for (const [key, value] of Object.entries(args ?? {})) {
    if (typeof value === "string" || typeof value === "number") {
      params[key] = String(value);
    }
  }
}

function addStationFieldParams(
  params: Record<string, string>,
  node: RunGraphNode,
): void {
  for (const field of STATION_PARAM_FIELDS) {
    const value = node[field];

    if (typeof value === "string" && value.length > 0) {
      params[field] = value;
    }
  }
}

/** The knob/args map a station node's pod receives as `station_input.params`, extracted so the recorded input names the SAME map the pod was handed. */
export function stationNodeParams(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
): Record<string, string> {
  const params: Record<string, string> = {};

  addLineArgParams(params, task.args);
  addStationFieldParams(params, node);

  return params;
}

/** Write-time caps for the recorded input, generous enough to hold a real prompt whole but bounded so one visit can't dominate the table. */
const INPUT_DESCRIPTION_MAX_BYTES = 4_096;
const INPUT_PROMPT_MAX_BYTES = 16_384;
const INPUT_PARAM_MAX_BYTES = 1_024;

/** What this visit was dispatched with, bounded for storage — recorded because the Agent CR is pruned after the run. `context` is deliberately absent (assembled later, far larger). */
export function stationRunInputFor(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  content: string,
  prompt: string | null,
): StationRunInput {
  const params =
    node.type === "agent"
      ? null
      : Object.fromEntries(
          Object.entries(stationNodeParams(node, task)).map(([key, value]) => [
            key,
            truncateForStorage(value, INPUT_PARAM_MAX_BYTES),
          ]),
        );

  return {
    ...boundedStationRunInput({
      description: content,
      prompt,
      repo: task.targetRepo,
      ref: cloneRef(task),
    }),
    params,
  };
}

/** The same write-time caps for a visit with no graph node (single-CR tasks like runbook/onboard/review), shared with {@link stationRunInputFor}. */
export function boundedStationRunInput(input: {
  description: string;
  prompt: string | null;
  repo: string;
  ref: string;
}): StationRunInput {
  return {
    description: truncateForStorage(
      input.description,
      INPUT_DESCRIPTION_MAX_BYTES,
    ),
    prompt:
      input.prompt === null
        ? null
        : truncateForStorage(input.prompt, INPUT_PROMPT_MAX_BYTES),
    // An agent visit runs a prompt, not a command.
    params: null,
    repo: input.repo,
    ref: input.ref,
  };
}

/** Pure: the Agent dispatch spec for one agent-node — prompt resolved per node, model from the node else inherited. */
/** Which visit of the node this spec is for; a first visit needs neither field. */
export interface NodeVisit {
  iteration?: number;
  stationRunId?: string;
}

export function nodeAgentSpec(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  prompt: string,
  { iteration = 1, stationRunId }: NodeVisit = {},
): LoreTaskSpec {
  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt,
    targetRepo: task.targetRepo,
    branch: cloneRef(task),
    ...(node.model ? { model: node.model } : {}),
    // A node's Station can differ from the line's taskType default (e.g. code-review-reply runs on code-review-refine); an inherited one is left unset so the subsystem applies its default.
    ...(node.station && !node.station_inherited
      ? { stationRef: node.station }
      : {}),
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration, stationRunId),
  };
}

/** Station types whose pod works on the repo checkout, so only these get the per-task token + clone triple; others read via the API. */
const CLONING_STATION_TYPES = new Set(["ingest", "validate"]);

/** Node knobs a station receives as its `params` (execution-relevant YAML fields minus routing fields). */
const STATION_PARAM_FIELDS = [
  "job_ref",
  "condition_ref",
  "prompt_ref",
  "model",
] as const;

/** Pure: the Agent dispatch spec for one STATION node — the whole node input rides one JSON parameter (`{station_input}`); Station defaults to `def-<type>`. */
export function nodeStationSpec(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  iteration = 1,
  stationRunId?: string,
): LoreTaskSpec {
  const params = stationNodeParams(node, task);

  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt: "",
    targetRepo: task.targetRepo,
    branch: cloneRef(task),
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration, stationRunId),
    stationRef: node.station ?? builtinStationName(node.type),
    clone: CLONING_STATION_TYPES.has(node.type),
    parameters: {
      // Via the shared writer, not an object literal: the shape is a contract with the pod image (apps/stations); a stray key on one side used to fail every run.
      station_input: serializeStationInput({
        assembly_run_id: task.assemblyLineId,
        node_id: node.id,
        node_type: node.type,
        repo: task.targetRepo,
        branch: cloneRef(task),
        task_id: task.taskId,
        params,
      }),
    },
  };
}
