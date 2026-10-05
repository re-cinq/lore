// The shape of a line as the run page draws it: the graph a run stored when it started, or a floor run's line mapped onto it. It mirrored the old engine's loader types until that loader was deleted (2026-10-02); the node types below are the ones stored runs carry.
export type DefinitionNodeType =
  | "agent"
  | "validate"
  | "retrospective"
  | "detect"
  | "ingest"
  | "issues"
  // One step of the merge line, parameterised by job_ref.
  | "merge_step"
  // Stations whose worker is a PERSON — the type names the form contract, `route` the page it lives on (FR6.40).
  | "feature_review"
  | "pr_review"
  | "ci_check";

export type DefinitionEdgeCondition = string;

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
  /** Started only by hand while the line waits on a person; no edge leads here. */
  by_hand?: boolean;
  /** Where a human station's worker acts — relative (this app) or absolute (e.g. a GitHub PR); `{args.x}` placeholders resolve API-side to a link or null. */
  route?: string;
  /** Capability tags a claiming cluster-agent must carry. */
  required_tags?: string[];
  /** Extra outcomes this node may emit beyond the standard set (FR11). */
  outcomes?: string[];
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
