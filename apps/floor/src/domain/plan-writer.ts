/** lore-api's plan writes as the Floor makes them (ADR-047): the planning agent's draft as agent edits, a Refine's answer as a proposal for one section. */

export interface AgentEditsBody {
  actor: string;
  ops: unknown[];
}

export interface ProposalBody extends AgentEditsBody {
  slot: string;
  baseHash: string;
  uses?: unknown;
}

export interface PlanWriter {
  applyOps(planId: string, body: AgentEditsBody): Promise<void>;
  propose(planId: string, body: ProposalBody): Promise<void>;
}
