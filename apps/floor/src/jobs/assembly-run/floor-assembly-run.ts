// Floor-side assembly-line node specs (ADR-031 D4). Each node dispatches its OWN
// Agent CR — this module is the pure spec-building core the event-driven walk
// (advance.ts) uses: names, identity labels, and the agent/station dispatch specs.

import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { serializeStationInput } from "@re-cinq/lore-shared/station-input.js";
import { stationName } from "../agent/agent-catalog.js";

export interface FloorAssemblyRunTask {
  taskId: string;
  /** The backing pipeline.tasks row id — null for task-less lines (code-review).
   *  Feeds the lease + audit + `Lore-Task:` trailer; a synthetic id there violates
   *  task_leases_task_fk. Token keying + CR labels use `taskId` instead. */
  pipelineTaskId: string | null;
  /** Per-attempt id (pipeline.assembly_runs) — CR names key on this, not the task. */
  assemblyLineId: string;
  taskType: string;
  description: string;
  targetRepo: string;
  branch: string;
  /** The line's args — string/number entries are threaded into a station's params
   *  (e.g. the comment-triage station reads comment_body / in_reply_to_id / pr_number). */
  args?: Record<string, unknown>;
}

/** Distinct Agent CR name per (attempt, node, ITERATION): two runs of one task never
 *  collide on a CR, and a REVISITED node (iteration>1) runs a fresh pod rather than
 *  409-reusing the prior iteration's terminal CR. Iteration 1 keeps the bare
 *  `<id12>-<nodeId>` form; revisits append `-<iteration>`. The 12-hex (48-bit)
 *  prefix is also the telemetry correlation key (#907): two DIFFERENT lines only
 *  collide on a CR name when their uuids share all 12 leading hex chars.
 *  The CR spec still carries the taskId — the watcher/reaper probe by task-id label. */
export function nodeAgentName(
  assemblyLineId: string,
  nodeId: string,
  iteration = 1,
): string {
  const base = `${assemblyLineId.substring(0, 12)}-${nodeId}`;

  return iteration > 1 ? `${base}-${iteration}` : base;
}

/** The CR name only carries a 12-char prefix; these labels carry the full identity
 *  so the k8s watch maps a terminal node CR back to its (line, node, iteration).
 *
 *  The label written on every CR since the writer flip (#1255, deployed
 *  2026-08-17). */
export const ASSEMBLY_RUN_ID_LABEL = "lore.re-cinq.com/assembly-run-id";
/** No longer written — kept as a READER (k8s-map, agent-watcher) for CRs created
 *  before the flip, which can outlive a rollout by up to a node's whole timeout.
 *  Legacy readers stay per FR6.44. */
export const LEGACY_ASSEMBLY_LINE_ID_LABEL =
  "lore.re-cinq.com/assembly-line-id";
export const NODE_ID_LABEL = "lore.re-cinq.com/node-id";
export const NODE_ITERATION_LABEL = "lore.re-cinq.com/node-iteration";
/** The station run this pod IS (FR6.39). The three labels above name the visit
 *  compositely; this one names it outright, so a pod found in the cluster maps
 *  back to its telemetry without re-deriving anything from the CR name. */
export const STATION_RUN_ID_LABEL = "lore.re-cinq.com/station-run-id";

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
    // Part of the spec builders so every dispatch path carries it — the reaper's
    // relaunch built the same spec without it, and the label's first consumer
    // would have silently lost every relaunched pod.
    ...(stationRunId ? { [STATION_RUN_ID_LABEL]: stationRunId } : {}),
  };
}

/** The git ref a node's pod checks out: `args.ref` when the line's branch is
 *  only a lease key (ingest lines lease `ingest/<kind>/<ref>`), else the branch. */
function cloneRef(task: FloorAssemblyRunTask): string {
  const ref = task.args?.ref;

  return typeof ref === "string" && ref.length > 0 ? ref : task.branch;
}

/** Pure: the Agent dispatch spec for one agent-node. Prompt is resolved per node; model
 *  from the node (else inherited); repo/branch/description from the task. */
export function nodeAgentSpec(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  prompt: string,
  iteration = 1,
  stationRunId?: string,
): LoreTaskSpec {
  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt,
    targetRepo: task.targetRepo,
    branch: cloneRef(task),
    ...(node.model ? { model: node.model } : {}),
    // An agent node's recipe/Station can differ from the line's taskType-derived
    // default — code-review-reply's node runs on code-review-refine. Without
    // this, the CR resolves a Station named after the LINE, which only existed
    // as a stale pre-#840-rename object until a catalog deploy pruned it.
    // The clone resolved it already, so an INHERITED station is left unset here
    // and the subsystem applies the same task-type default it always did.
    ...(node.station && !node.station_inherited
      ? { stationRef: node.station }
      : {}),
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration, stationRunId),
  };
}

/** Station types whose pod works on the repo checkout — only these get the
 *  per-task token + clone triple. The rest read via the API, and their line
 *  branch can be a synthetic lease key no `git checkout` could resolve. */
const CLONING_STATION_TYPES = new Set(["ingest", "validate"]);

/** Node knobs a station receives as its `params` (everything execution-relevant
 *  the YAML can say about the node, minus the routing fields). */
const STATION_PARAM_FIELDS = [
  "job_ref",
  "condition_ref",
  "prompt_ref",
  "model",
] as const;

/** Pure: the Agent dispatch spec for one STATION node (validate/detect/…). The
 *  recipe's prompt template is literally `{station_input}`, so the whole node
 *  input rides one JSON parameter; the Station defaults to `def-<type>` unless
 *  the node names a custom one via `station_ref`. */
export function nodeStationSpec(
  node: RunGraphNode,
  task: FloorAssemblyRunTask,
  iteration = 1,
  stationRunId?: string,
): LoreTaskSpec {
  const params: Record<string, string> = {};

  // Line args (string/number) ride into params so a station reads its input without
  // a DB round-trip — e.g. the comment-triage station's comment_body/in_reply_to_id.
  for (const [key, value] of Object.entries(task.args ?? {})) {
    if (typeof value === "string" || typeof value === "number") {
      params[key] = String(value);
    }
  }

  for (const field of STATION_PARAM_FIELDS) {
    const value = node[field];

    if (typeof value === "string" && value.length > 0) {
      params[field] = value;
    }
  }

  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    prompt: "",
    targetRepo: task.targetRepo,
    branch: cloneRef(task),
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration, stationRunId),
    stationRef: node.station ?? stationName(node.type),
    // Stations render only {station_input} — never hydrate (D5 is for agent
    // nodes); an empty description otherwise assembles an unbounded context.
    hydrate: false,
    clone: CLONING_STATION_TYPES.has(node.type),
    parameters: {
      // Written through the shared writer, not an object literal: the shape is a
      // contract with `apps/lore-station`, a separately built and deployed image,
      // and it used to be spelled out independently on each side. A sweep once
      // renamed this side's `assembly_line_id` and left the pod's parser alone,
      // which would have failed every station run. Now a key that exists on only
      // one side does not compile.
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
