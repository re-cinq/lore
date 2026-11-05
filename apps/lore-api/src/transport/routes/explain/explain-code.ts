import { z } from "zod";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { Llm } from "@re-cinq/lore-shared/llm/llm.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import {
  explainCode,
  type ExplainDeps,
  type ExplainRequest,
} from "../../../work/explain/explain-code.js";

const ExplainBody = z.object({
  path: z.string().min(1).max(1024),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  code: z.string().min(1).max(20_000),
});

const ExplanationSchema = z.object({
  answer: z.string(),
  statements: z.array(
    z.object({
      text: z.string(),
      via: z.enum(["validated", "implemented", "covered"]),
    }),
  ),
  model: z.string().nullable(),
});

let depsOverride: ExplainDeps | undefined;

/** Test seam — the route closes over module state, not a request-time import. */
export function setExplainDepsForTests(deps: ExplainDeps | undefined): void {
  depsOverride = deps;
}

export function explainCodeRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/explain",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { payload: zodValidate(ExplainBody) },
      },
      ExplanationSchema,
      {
        name: "Explanation",
        description:
          "What a span of code does, in at most two paragraphs grounded in the spec statements linked to it; I don't know when none are",
        errors: [400],
      },
    ),
    handler: (request, h) => serveExplain(request, h),
  };
}

async function serveExplain(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const body = request.payload as z.infer<typeof ExplainBody>;

  enforceTrue(
    body.end_line >= body.start_line,
    apiError(400),
    "end_line is before start_line",
  );
  const repo = `${request.params.owner}/${request.params.repo}`;
  const deps = depsOverride ?? (await explainDeps(repo));

  return h.response(await explainCode(deps, explainRequestOf(body)));
}

function explainRequestOf(body: z.infer<typeof ExplainBody>): ExplainRequest {
  return {
    span: {
      file: body.path,
      startLine: body.start_line,
      endLine: body.end_line,
    },
    code: body.code,
  };
}

async function explainDeps(repo: string): Promise<ExplainDeps> {
  const { trace } = await projectFor(repo);

  return {
    llm: Llm.for("explain"),
    statementsAt: (span) => trace.statementsAt(span),
  };
}
