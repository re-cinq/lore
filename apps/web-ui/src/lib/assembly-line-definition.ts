// Hand mirror of the assembly-line definition types from
// libs/assembly-lines/src/loader.ts (AssemblyLineNode / AssemblyLineEdge /
// AssemblyLine, all inferred from their zod schemas). web-ui cannot import
// libs/, so scripts/type-drift/assembly-line-definition.drift.ts asserts this
// mirror carries every canonical key and both closed unions verbatim.
//
// The node `type` and edge `on` unions are mirrored as unions rather than
// `string`: run-node-status and the DAG renderer depend on exhaustiveness.

export type DefinitionNodeType =
  | "agent"
  | "validate"
  | "gate"
  | "retrospective"
  | "github_action"
  | "detect"
  | "comment-triage"
  | "ingest";

export type DefinitionEdgeCondition =
  "success" | "changes_requested" | "failed" | "always";

export interface DefinitionNode {
  id: string;
  type: DefinitionNodeType;
  prompt_ref?: string;
  model?: string;
  validator?: string;
  condition_ref?: string;
  job_ref?: string;
  station_ref?: string;
  timeout_minutes?: number;
  description?: string;
}

export interface DefinitionEdge {
  from: string;
  to: string;
  on: DefinitionEdgeCondition;
  iteration_max?: number;
}

export interface AssemblyLineDefinition {
  name: string;
  description: string;
  version: 1;
  entry: string;
  exit: string;
  nodes: DefinitionNode[];
  edges: DefinitionEdge[];
}
