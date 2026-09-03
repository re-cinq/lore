// Hand mirror of libs/assembly-lines/src/loader.ts's definition types — web-ui can't import libs/, so scripts/type-drift/assembly-line-definition.drift.ts guards it. Structural, not debt (#1419): the Floor serves no OpenAPI document here.
export type DefinitionNodeType =
  | "agent"
  | "validate"
  | "retrospective"
  | "detect"
  | "comment-triage"
  | "ingest"
  | "issues"
  // One step of the merge line, parameterised by job_ref.
  | "merge_step"
  // One step of the escalation line, parameterised the same way.
  | "escalation_step"
  // Stations whose worker is a PERSON — the type names the form contract, `route` the page it lives on (FR6.40).
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
  /** Where a human station's worker acts — relative (this app) or absolute (e.g. a GitHub PR); `{args.x}` placeholders resolve API-side to a link or null. */
  route?: string;
  /** Capability tags a claiming cluster-agent must carry. */
  required_tags?: string[];
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
