import { z } from "zod";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import {
  hybridSearch,
  type SearchResult,
} from "@re-cinq/lore-server-core/platform/db.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { clampedLimit } from "../common-schemas.js";

// The corpus search behind `lore_search_context`. It lives here because the adapter holds no pool (ADR-032): without this route the tool's only path was a substring scan of the caller's local checkout, which answers nothing a natural-language question asks.
const SearchContextResultSchema = z.object({
  results: z.array(
    z.object({
      content: z.string(),
      score: z.number(),
      source_path: z.string().nullable(),
    }),
  ),
});

const SearchContextQuery = z.object({
  query: z.string().min(1),
  team: z.string().optional(),
  limit: clampedLimit.default(8),
});

type SearchContextQuery = z.infer<typeof SearchContextQuery>;

export function searchContextRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/search-context",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(SearchContextQuery) },
      },
      SearchContextResultSchema,
      {
        name: "SearchContextResults",
        description:
          "Hybrid vector + BM25 passages from the ingested corpus, highest-scoring first",
        errors: [400],
      },
    ),
    handler: serveSearchContext,
  };
}

async function serveSearchContext(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { query, team, limit } = request.query as SearchContextQuery;
  const results = await searchWithOrgSharedFallback(query, team, limit);

  return h.response({ results: results.map(toWire) });
}

/** A provisioned team schema that matched nothing still leaves the org-wide corpus to try; only an org_shared miss is a real miss. */
async function searchWithOrgSharedFallback(
  query: string,
  team: string | undefined,
  limit: number,
): Promise<SearchResult[]> {
  const schema = team || "org_shared";
  const results = await hybridSearch(query, schema, limit);

  if (results.length > 0 || !team || team === "org_shared") {
    return results;
  }

  return hybridSearch(query, "org_shared", limit);
}

function toWire(result: SearchResult) {
  const filePath = result.metadata.file_path;

  return {
    content: result.content,
    score: result.rrf_score,
    source_path: typeof filePath === "string" ? filePath : null,
  };
}
