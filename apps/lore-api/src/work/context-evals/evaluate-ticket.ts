// A ticket-shaped context eval (specs/context-evals FR4.7): the block an implementer of one ticket is handed, graded 0 to 3 for that ticket.

import type { LlmProvider } from "@re-cinq/lore-shared/llm/llm-provider.js";
import type { KnowledgeBackend } from "@re-cinq/lore-shared/knowledge-backend.js";
import type { SingleBackend } from "./side-by-side.js";

const JOB_NAME = "context-evals";
const BODY_QUERY_CHARS = 700;

export interface Ticket {
  number: number;
  title: string;
  body: string;
}

export interface TicketDeps {
  llm: LlmProvider;
  judgeModel?: string;
  assemble(
    repo: string,
    query: string,
    backend: SingleBackend,
  ): Promise<{ text: string; sections: string[] }>;
  clock?: () => number;
}

export interface TicketGrade {
  score: 0 | 1 | 2 | 3;
  useful: string[];
  noise: string;
}

export interface TicketVerdict extends TicketGrade {
  model: string;
  latency_ms: number;
  chars: number;
  sections: string[];
}

export interface TicketTarget {
  repo: string;
  ticket: Ticket;
  backend: KnowledgeBackend;
}

const JUDGE_SYSTEM =
  "You grade the context block an implementer is handed before starting a ticket. Score it for THAT ticket: 0 = nothing relevant, 1 = generic repo background only, 2 = at least one fact specific to this ticket (a file, a convention, a decision, a prior attempt), 3 = several ticket-specific facts an implementer would otherwise dig for. In useful, list at most 5 short items an implementer would act on. In noise, say in one line what in the block is irrelevant or filler.";

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 3 },
    useful: { type: "array", items: { type: "string" }, maxItems: 5 },
    noise: { type: "string" },
  },
  required: ["score", "useful", "noise"],
};

export function ticketQuery({ title, body }: Ticket): string {
  return `${title}\n\n${body.slice(0, BODY_QUERY_CHARS)}`;
}

/** One side under `lore` or `utopia`; under `both` each store is assembled in turn, so neither's latency carries the other's load. */
export async function evaluateTicket(
  deps: TicketDeps,
  { repo, ticket, backend }: TicketTarget,
): Promise<TicketVerdict | { lore: TicketVerdict; utopia: TicketVerdict }> {
  if (backend !== "both") {
    return gradeSide(deps, repo, ticket, backend);
  }
  const lore = await gradeSide(deps, repo, ticket, "lore");
  const utopia = await gradeSide(deps, repo, ticket, "utopia");

  return { lore, utopia };
}

async function gradeSide(
  deps: TicketDeps,
  repo: string,
  ticket: Ticket,
  backend: SingleBackend,
): Promise<TicketVerdict> {
  const { clock = () => performance.now() } = deps;
  const started = clock();
  const block = await deps.assemble(repo, ticketQuery(ticket), backend);
  const latency_ms = Math.round(clock() - started);
  const { parsed, model } = await judge(deps, ticket, block.text);

  return {
    ...parsed,
    model,
    latency_ms,
    chars: block.text.length,
    sections: block.sections,
  };
}

async function judge(
  { llm, judgeModel }: TicketDeps,
  ticket: Ticket,
  block: string,
): Promise<{ parsed: TicketGrade; model: string }> {
  return llm.completeWithTool<TicketGrade>({
    ...(judgeModel ? { model: judgeModel } : {}),
    systemPrompt: JUDGE_SYSTEM,
    prompt: `Ticket #${ticket.number}: ${ticket.title}\n\n${ticket.body}\n\nContext block:\n\n${block}`,
    toolName: "grade",
    toolDescription: "The block's score for this ticket",
    toolSchema: GRADE_SCHEMA,
    jobName: JOB_NAME,
    temperature: 0,
  });
}
