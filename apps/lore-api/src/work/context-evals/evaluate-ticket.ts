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

interface UsefulItem {
  fact: string;
  quote: string;
}

/** What the judge reports; the score is decided in code from the items whose quote is in the block (FR4.7). */

interface Judged {
  useful: UsefulItem[];
  background: boolean;
  noise: string;
}

const SEVERAL = 3;

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
  "You read the context block an implementer is handed before starting a ticket. In useful, list at most 5 facts in the block that are specific to THIS ticket (a file, a convention, a decision, a prior attempt) and that an implementer would act on; for each, quote is a span of the block copied word for word that states the fact. Leave useful empty when the block holds nothing specific to the ticket. background is true when the block holds generic background on the repository. In noise, say in one line what in the block is irrelevant or filler.";

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    useful: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: { fact: { type: "string" }, quote: { type: "string" } },
        required: ["fact", "quote"],
      },
    },
    background: { type: "boolean" },
    noise: { type: "string" },
  },
  required: ["useful", "background", "noise"],
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
    ...graded(parsed, block.text),
    model,
    latency_ms,
    chars: block.text.length,
    sections: block.sections,
  };
}

/** A useful item counts only when its quote is in the block: 0 with none and no background, 1 with background only, 2 with one or two, 3 with several. A judge that grades generously has nothing there to quote. */
export function graded(judged: Judged, block: string): TicketGrade {
  const text = flattened(block);
  const grounded = judged.useful.filter(
    ({ quote }) => quote.trim().length > 0 && text.includes(flattened(quote)),
  );
  const useful = grounded.map(({ fact }) => fact);

  if (grounded.length >= SEVERAL) {
    return { score: 3, useful, noise: judged.noise };
  }

  if (grounded.length > 0) {
    return { score: 2, useful, noise: judged.noise };
  }

  return { score: judged.background ? 1 : 0, useful, noise: judged.noise };
}

function flattened(text: string): string {
  return text.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

async function judge(
  { llm, judgeModel }: TicketDeps,
  ticket: Ticket,
  block: string,
): Promise<{ parsed: Judged; model: string }> {
  return llm.completeWithTool<Judged>({
    ...(judgeModel ? { model: judgeModel } : {}),
    systemPrompt: JUDGE_SYSTEM,
    prompt: `Ticket #${ticket.number}: ${ticket.title}\n\n${ticket.body}\n\nContext block:\n\n${block}`,
    toolName: "grade",
    toolDescription:
      "What in the block is specific to this ticket, each with its quote",
    toolSchema: GRADE_SCHEMA,
    jobName: JOB_NAME,
    temperature: 0,
  });
}
