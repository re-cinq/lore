import { testLinksOfDoc } from "@re-cinq/lore-shared/spec-link-parser.js";
import { z } from "zod";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

/** POST the content of specs and ADRs, get back every test link they carry — parsed by the one parser the graph and the web-ui also read through, so a CI check in any language judges the same links (specs/spec-test-coverage). Pure: no database, no graph. */

const SpecLinksParseBody = z.object({
  docs: z.array(z.object({ path: z.string(), content: z.string() })),
});

type SpecLinksParseBody = z.infer<typeof SpecLinksParseBody>;

const SpecLinksParseResult = z.object({
  links: z.array(
    z.object({
      doc_path: z.string(),
      /** 1-based line of the statement carrying the link; null when unknown. */
      statement_line: z.number().nullable(),
      label: z.string(),
      /** Repo-relative path of the linked test file. */
      path: z.string(),
      line: z.number().nullable(),
      /** True for a link outside its statement's trailing parenthetical. */
      misplaced: z.boolean(),
    }),
  ),
});

const SPEC_LINKS_PARSE_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: { payload: zodValidate(SpecLinksParseBody) },
  },
  SpecLinksParseResult,
  {
    name: "SpecLinksParseResult",
    description: "The test links the posted specs and ADRs carry",
    errors: [400],
  },
);

export function specLinksParseRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-links/parse",
    options: SPEC_LINKS_PARSE_OPTIONS,
    handler: serveSpecLinksParse,
  };
}

function serveSpecLinksParse(
  request: Request,
  h: ResponseToolkit,
): ResponseObject {
  const { docs } = request.payload as SpecLinksParseBody;

  return h.response({
    links: docs.flatMap((doc) =>
      testLinksOfDoc(doc.path, doc.content).map((link) => ({
        doc_path: doc.path,
        statement_line: link.statementLine,
        label: link.label,
        path: link.path,
        line: link.line,
        misplaced: link.misplaced,
      })),
    ),
  });
}
