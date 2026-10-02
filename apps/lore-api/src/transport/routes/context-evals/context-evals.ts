import { z } from "zod";
import type { Pool } from "pg";
import type { ResponseObject, ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { repoFullName } from "../common-schemas.js";
import { withPool, type PooledHandler } from "../with-pool.js";
import { assembleForEval } from "../../../work/context-evals/assembled-for-eval.js";
import { documentText } from "../../../work/context-evals/eval-documents.js";
import {
  evaluateDocument,
  type EvalDeps,
} from "../../../work/context-evals/evaluate-document.js";

/** One document's context eval (specs/context-evals): the nightly CI job posts each sampled document here and reads back whether Lore found it, whether a model could answer from what Lore returned, and how much of that was used. */

const ContextEvalBody = z.object({
  repo: repoFullName,
  path: z.string().min(1).max(500),
});

const DocumentEvalSchema = z.object({
  path: z.string(),
  question: z.string(),
  found: z.boolean(),
  answered: z.boolean(),
  useful_share: z.number(),
  reason: z.string(),
  model: z.string(),
});

let depsOverride: EvalDeps | undefined;

/** Test seam — the route closes over module state, not a request-time import. */
export function setEvalDepsForTests(deps: EvalDeps | undefined): void {
  depsOverride = deps;
}

export function contextEvalRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/context-evals",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { payload: zodValidate(ContextEvalBody) },
      },
      DocumentEvalSchema,
      {
        name: "DocumentEval",
        description: "One document's context eval",
        errors: [400, 404],
      },
    ),
    handler: withPool(getPool, serveContextEval),
  };
}

const serveContextEval: PooledHandler = async (
  pool,
  request,
  h,
): Promise<ResponseObject> => {
  const target = request.payload as z.infer<typeof ContextEvalBody>;
  const verdict = await evaluateDocument(
    depsOverride ?? evalDeps(pool),
    target,
  );

  enforceTrue(
    verdict !== null,
    apiError(404),
    `no ADR or spec at ${target.path} in ${target.repo}`,
  );

  return h.response(verdict);
};

/** The model evals run on is their own (`LORE_EVAL_LLM_PROVIDER`), so they can sit on another vendor than every other call. */
function evalDeps(pool: Pool): EvalDeps {
  return {
    llm: Llm.for("eval"),
    document: (repo, path) => documentText(pool, repo, path),
    assemble: (repo, question) => assembleForEval(pool, repo, question),
  };
}
