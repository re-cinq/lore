// The section a person asked the planning agent to refine, held by lore-api rather than by the run's bag: a node started by hand carries no items, so the agent and the pass end both read the ask from here (specs/7-feature-planning FR-18).

/** One pending Refine: the section, what was settled in it, and its hash when the ask was made. */
export interface RefineAsk {
  planId: string;
  slot: string;
  title: string;
  baseHash: string;
  inputs: unknown;
  uses: unknown;
  /** What the agent is told to do, as `refineBrief` words it: the ask travels no other way. */
  brief: string;
}

/** A plan has at most one pending ask: a second Refine on the same plan replaces it. */
export interface RefineAsks {
  record(ask: RefineAsk): Promise<void>;
  pending(planId: string): Promise<RefineAsk | null>;
  /** Answered or abandoned: the section stops saying the agent is refining it. */
  clear(planId: string): Promise<void>;
}
