import { z } from "zod";
import type { Pool } from "pg";
import type { ResponseObject, ServerRoute } from "@hapi/hapi";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { KnowledgeBackendSchema } from "@re-cinq/lore-shared/knowledge-backend.js";
import { bearerScope } from "../../http/bearer-scope.js";
import {
  zodResponse,
  type ZodResponseOptions,
} from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { repoFullName } from "../common-schemas.js";
import { withPool, type PooledHandler } from "../with-pool.js";
import { assembleForTicket } from "../../../work/context-evals/assembled-for-eval.js";
import {
  evaluateTicket,
  type TicketDeps,
} from "../../../work/context-evals/evaluate-ticket.js";

/** One ticket's context eval (specs/context-evals FR4.7): the block an implementer of the ticket is handed, graded 0 to 3 for that ticket. */

const TicketEvalBody = z.object({
  repo: repoFullName,
  ticket: z.object({
    number: z.number().int(),
    title: z.string().min(1).max(500),
    body: z.string().max(65_000),
  }),
  backend: KnowledgeBackendSchema.optional(),
});

const TicketVerdictSchema = z.object({
  score: z.number().int().min(0).max(3),
  useful: z.array(z.string()),
  noise: z.string(),
  model: z.string(),
  latency_ms: z.number(),
  chars: z.number(),
  sections: z.array(z.string()),
});

const TicketEvalSchema = z.union([
  TicketVerdictSchema,
  z.object({ lore: TicketVerdictSchema, utopia: TicketVerdictSchema }),
]);

const TICKET_EVAL_DOC: ZodResponseOptions = {
  name: "TicketEval",
  description: "One ticket's context eval",
  errors: [400],
};

let depsOverride: TicketDeps | undefined;

/** Test seam — the route closes over module state, not a request-time import. */
export function setTicketEvalDepsForTests(deps: TicketDeps | undefined): void {
  depsOverride = deps;
}

export function contextEvalTicketRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/context-evals/ticket",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(TicketEvalBody) },
      },
      TicketEvalSchema,
      TICKET_EVAL_DOC,
    ),
    handler: withPool(getPool, serveTicketEval),
  };
}

const serveTicketEval: PooledHandler = async (
  pool,
  request,
  h,
): Promise<ResponseObject> => {
  const {
    repo,
    ticket,
    backend = "lore",
  } = request.payload as z.infer<typeof TicketEvalBody>;

  return h.response(
    await evaluateTicket(depsOverride ?? ticketDeps(pool), {
      repo,
      ticket,
      backend,
    }),
  );
};

function ticketDeps(pool: Pool): TicketDeps {
  return {
    llm: Llm.for("eval"),
    judgeModel: process.env.LORE_EVAL_JUDGE_MODEL,
    assemble: (repo, query, backend) =>
      assembleForTicket(pool, repo, query, backend),
  };
}
