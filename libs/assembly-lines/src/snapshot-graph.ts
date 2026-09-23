// Converts a blueprint into the graph one run carries a copy of (specs/6-dark-factory FR6.38), so a run stops depending on a FILE that can change under it (advanceLine used to re-read the YAML at every step). Resolves the Station once here (station_inherited flags when re-deriving it per-call would let a reused node silently run the wrong recipe, as happened on the planning line) and produces a FAITHFUL copy — the blueprint's own field names plus the resolved station — using the shared `RunGraph` type rather than a hand-mirror that can drift.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyLine, AssemblyLineNode } from "./loader.js";
import { resolveNodeStation } from "./node-station.js";
import type {
  RunGraph,
  RunGraphNode,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

type OptionalNodeFields = Partial<
  Omit<RunGraphNode, "id" | "type" | "station" | "station_inherited">
>;

/** Where a run enters the blueprint when not at its own entry — a revision re-runs the tail of a line whose head a person already settled. */
export interface SnapshotOptions {
  entry?: string;
}

// The blueprint as a run will record it. `lineTaskType` (what an inherited Station names after) is passed explicitly since the resolution rule is the caller's context, not a graph property.
export function snapshotGraph(
  definition: AssemblyLine,
  lineTaskType: string,
  options: SnapshotOptions = {},
): RunGraph {
  return {
    name: definition.name,
    entry: entryOf(definition, options.entry),
    exit: definition.exit,
    nodes: definition.nodes.map((node) => snapshotNode(node, lineTaskType)),
    edges: definition.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      on: edge.on,
      ...(edge.iteration_max ? { iteration_max: edge.iteration_max } : {}),
    })),
  };
}

/** Why a named entry cannot open this blueprint, or null when it can: a walk entered at a node that does not exist would fail at its first replay, one event later and with a worse message. */
export function entryNodeProblem(
  definition: Pick<AssemblyLine, "name" | "nodes">,
  entry: string,
): string | null {
  return definition.nodes.some((node) => node.id === entry)
    ? null
    : `entry node "${entry}" is not a node of ${definition.name}`;
}

function entryOf(definition: AssemblyLine, entry: string | undefined): string {
  if (entry === undefined) {
    return definition.entry;
  }
  const problem = entryNodeProblem(definition, entry);

  enforceTrue(problem === null, Error, problem ?? "");

  return entry;
}

function snapshotNode(
  node: AssemblyLineNode,
  lineTaskType: string,
): RunGraphNode {
  const { station, inherited } = resolveNodeStation(node, lineTaskType);

  return {
    id: node.id,
    type: node.type,
    station,
    station_inherited: inherited,
    ...optionalNodeFields(node),
  };
}

// Optional fields are OMITTED (not null) since `{}` survives a jsonb round-trip identically while keeping stored rows small.
function optionalNodeFields(node: AssemblyLineNode): OptionalNodeFields {
  const candidates: Array<[keyof OptionalNodeFields, unknown]> = [
    ["prompt_ref", node.prompt_ref],
    ["model", node.model],
    ["timeout_minutes", node.timeout_minutes],
    ["required_tags", copiedRequiredTags(node)],
    ["condition_ref", node.condition_ref],
    ["job_ref", node.job_ref],
    ["route", node.route],
    ["continues", copiedContinues(node)],
    ["description", node.description],
  ];

  return Object.fromEntries(
    candidates.filter(([, value]) => value),
  ) as OptionalNodeFields;
}

function copiedRequiredTags(node: AssemblyLineNode): string[] | undefined {
  return node.required_tags ? [...node.required_tags] : undefined;
}

function copiedContinues(
  node: AssemblyLineNode,
): { node: string; key: string } | undefined {
  return node.continues ? { ...node.continues } : undefined;
}
