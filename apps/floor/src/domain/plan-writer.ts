/** lore-api's plan reads and writes as the Floor makes them (ADR-047): the live plan as the Markdown file a planning pod edits, and that file handed back — as a draft, or as a Refine's proposal for one section. */

/** The Refine a planning pass answers, recorded on its run when the Refine was asked for. */
export interface RefineContext {
  slot: string;
  baseHash: string;
  uses?: unknown;
}

/** The plan a planning run works on, and the Refine it answers (null for a draft). */
export interface PlanRunRef {
  planId: string;
  refine: RefineContext | null;
}

export interface PlanFileBody {
  actor: string;
  markdown: string;
  refine: RefineContext | null;
}

export interface PlanWriter {
  markdownOf(planId: string): Promise<string>;
  submitFile(planId: string, body: PlanFileBody): Promise<void>;
}
