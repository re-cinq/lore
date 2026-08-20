// Hand mirror of the assembly-line definition types from
// libs/assembly-lines/src/loader.ts (AssemblyLineNode / AssemblyLineEdge /
// AssemblyLine, all inferred from their zod schemas). web-ui cannot import
// libs/, so scripts/type-drift/assembly-line-definition.drift.ts asserts this
// mirror carries every canonical key and both closed unions verbatim.
//
// The node `type` and edge `on` unions are mirrored as unions rather than
// `string`: run-node-status and the DAG renderer depend on exhaustiveness.
//
// DECISION (#1419): structural, not debt. Same reason as run-stream-types — the
// Floor serves /api/assembly-line-definitions and generates no OpenAPI document.

export type DefinitionNodeType =
  | "agent"
  | "validate"
  | "gate"
  | "retrospective"
  | "github_action"
  | "detect"
  | "comment-triage"
  | "ingest"
  | "issues"
  // Stations whose worker is a PERSON. The type names the form contract; `route`
  // names the page it lives on (FR6.40).
  | "feature_review"
  | "pr_review";

export type DefinitionEdgeCondition =
  "success" | "changes_requested" | "failed" | "always";

export interface DefinitionNode {
  id: string;
  type: DefinitionNodeType;
  prompt_ref?: string;
  model?: string;
  condition_ref?: string;
  job_ref?: string;
  station_ref?: string;
  timeout_minutes?: number;
  description?: string;
  /** Which previous run this node continues, and what keys the thread. */
  continues?: { node: string; key: string };
  /** Where a human station's worker acts. Relative — a page this app serves;
   *  absolute — one it does not own, such as a GitHub PR. `{args.x}` placeholders
   *  are resolved by the API against the run's args, so what reaches a view is
   *  either a followable link or null. */
  route?: string;
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
