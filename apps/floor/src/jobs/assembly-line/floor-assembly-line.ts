// Floor-side assembly-line node specs (ADR-031 D4). Each node dispatches its OWN
// Agent CR — this module is the pure spec-building core the event-driven walk
// (advance.ts) uses: names, identity labels, and the agent/station dispatch specs.

import type { AssemblyLineNode } from "@re-cinq/lore-assembly-lines";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import { stationName } from "../agent/agent-catalog.js";

export interface FloorAssemblyLineTask {
  taskId: string;
  /** The backing pipeline.tasks row id — null for task-less lines (code-review).
   *  Feeds the lease + audit + `Lore-Task:` trailer; a synthetic id there violates
   *  task_leases_task_fk. Token keying + CR labels use `taskId` instead. */
  pipelineTaskId: string | null;
  /** Per-attempt id (pipeline.assembly_lines) — CR names key on this, not the task. */
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
 *  `<id8>-<nodeId>` form (back-compat); revisits append `-<iteration>`.
 *  The CR spec still carries the taskId — the watcher/reaper probe by task-id label. */
export function nodeAgentName(
  assemblyLineId: string,
  nodeId: string,
  iteration = 1,
): string {
  const base = `${assemblyLineId.substring(0, 8)}-${nodeId}`;

  return iteration > 1 ? `${base}-${iteration}` : base;
}

/** The CR name only carries an 8-char prefix; these labels carry the full identity
 *  so the k8s watch maps a terminal node CR back to its (line, node, iteration). */
export const ASSEMBLY_LINE_ID_LABEL = "lore.re-cinq.com/assembly-line-id";
export const NODE_ID_LABEL = "lore.re-cinq.com/node-id";
export const NODE_ITERATION_LABEL = "lore.re-cinq.com/node-iteration";

function nodeLabels(
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  iteration: number,
): Record<string, string> {
  return {
    [ASSEMBLY_LINE_ID_LABEL]: task.assemblyLineId,
    [NODE_ID_LABEL]: node.id,
    [NODE_ITERATION_LABEL]: String(iteration),
  };
}

/** The git ref a node's pod checks out: `args.ref` when the line's branch is
 *  only a lease key (ingest lines lease `ingest/<kind>/<ref>`), else the branch. */
function cloneRef(task: FloorAssemblyLineTask): string {
  const ref = task.args?.ref;

  return typeof ref === "string" && ref.length > 0 ? ref : task.branch;
}

/** Pure: the Agent dispatch spec for one agent-node. Prompt is resolved per node; model
 *  from the node (else inherited); repo/branch/description from the task. */
export function nodeAgentSpec(
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  prompt: string,
  iteration = 1,
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
    ...(node.station_ref ? { stationRef: node.station_ref } : {}),
    name: nodeAgentName(task.assemblyLineId, node.id, iteration),
    extraLabels: nodeLabels(node, task, iteration),
  };
}

/** Node knobs a station receives as its `params` (everything execution-relevant
 *  the YAML can say about the node, minus the routing fields). */
const STATION_PARAM_FIELDS = [
  "validator",
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
  node: AssemblyLineNode,
  task: FloorAssemblyLineTask,
  iteration = 1,
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
    extraLabels: nodeLabels(node, task, iteration),
    stationRef: node.station_ref ?? stationName(node.type),
    // Stations render only {station_input} — never hydrate (D5 is for agent
    // nodes); an empty description otherwise assembles an unbounded context.
    hydrate: false,
    parameters: {
      station_input: JSON.stringify({
        assembly_line_id: task.assemblyLineId,
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
