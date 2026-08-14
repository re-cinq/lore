// The graph a run recorded, as web-ui receives it (specs/6-dark-factory FR6.38).
//
// A hand mirror of `RunGraph` in `@re-cinq/lore-shared`, for the same reason every
// other mirror here exists: web-ui is excluded from the npm workspace and built in
// an isolated Docker context, so it cannot import the canonical type.
//
// This REPLACES the transcribed blueprint catalog that used to live in
// `builtin-definitions.ts` — 350 lines of YAML copied by hand, which went stale
// the moment a definition changed and could only ever describe the CURRENT
// blueprint, never the one a given run actually walked.

export interface RunGraphNode {
  id: string;
  type: string;
  station: string | null;
  station_inherited?: boolean;
  route?: string;
  prompt_ref?: string;
  model?: string;
  timeout_minutes?: number;
  validator?: string;
  condition_ref?: string;
  job_ref?: string;
  continues?: { node: string; key: string };
  description?: string;
}

export interface RunGraphEdge {
  from: string;
  to: string;
  on: string;
  iteration_max?: number;
}

export interface RunGraph {
  name: string;
  entry: string;
  exit: string;
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}
