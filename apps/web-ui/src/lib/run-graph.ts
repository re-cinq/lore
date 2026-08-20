// The graph a run recorded, as web-ui receives it (specs/6-dark-factory FR6.38).
//
// A hand mirror of `RunGraph` in `@re-cinq/lore-shared`, for the same reason every
// other mirror here exists: web-ui is excluded from the npm workspace and built in
// an isolated Docker context, so it cannot import the canonical type. Guarded by
// `scripts/type-drift/run-graph.drift.ts` (`npm run typecheck:drift`), exact both
// ways — a shared-side field change goes red here instead of silently narrowing
// the graph the run views draw.
//
// This REPLACES the transcribed blueprint catalog that used to live in
// `builtin-definitions.ts` — 350 lines of YAML copied by hand, which went stale
// the moment a definition changed and could only ever describe the CURRENT
// blueprint, never the one a given run actually walked.
//
// DECISION (#1419): removable, but BLOCKED. lore-api serves this inside the run
// reads, so a generated type is reachable in principle — except the model states
// the field as `z.custom<RunGraph>()`, which renders as an open schema, so the
// generated type is `unknown`. Aliasing to it would lose every field name rather
// than gain safety. The unblock is to declare RunGraph as a zod schema in
// libs/shared/src/project/assembly-runs/run-graph.ts and reference it from the
// model — one declaration, generated on both sides, mirror and guard both gone.

export interface RunGraphNode {
  id: string;
  type: string;
  station: string | null;
  station_inherited: boolean;
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
