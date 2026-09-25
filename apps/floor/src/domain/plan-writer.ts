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

/** A Refine whose pass failed before it answered: the section is told why, so its person can ask again. */
export interface FailedRefine {
  slot: string;
  reason: string;
}

/** Agent-authored plan operations, as planning-sync's agent-edits route takes them (`add-question` and its kin); the Floor forwards them, it does not interpret them. */
export interface PlanAgentEdits {
  actor: string;
  ops: unknown[];
}

/** One section of the live plan: the slot an agent op addresses it by, and the title its people read. */
export interface PlanSection {
  slot: string;
  title: string;
}

/** One finding block as it stands on the live plan, for reconciling a new pass against it. */
export interface PlanFinding {
  slot: string;
  findingId: string;
  resolved: boolean;
}

export interface PlanWriter {
  markdownOf(planId: string): Promise<string>;
  submitFile(planId: string, body: PlanFileBody): Promise<void>;
  failRefine(planId: string, refine: FailedRefine): Promise<void>;
  /** The spec writer's questions for the plan's people, added as agent edits. */
  addQuestions(planId: string, edits: PlanAgentEdits): Promise<void>;
  /** The plan's current finding blocks, for a validator pass reconciling against them. */
  findingsOf(planId: string): Promise<PlanFinding[]>;
  /** The plan's sections in order, for landing an agent's question on a slot the plan has. */
  sectionsOf(planId: string): Promise<PlanSection[]>;
}

/** lore-api's answer to a planning line parked on a human station: an approved plan is reopened for writing when its author is asked, or when the spec review sent questions to it; any other plan is left as it is. */
export interface PlanOpener {
  openForAuthor(repo: string, planId: string): Promise<void>;
  reopenForReview(repo: string, planId: string, actor: string): Promise<void>;
}
