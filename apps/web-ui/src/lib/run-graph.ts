// Hand mirror of RunGraph (isolated Docker build); drift-guarded; replaces stale transcribed catalog (#1419 blocked on zod schema).

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
