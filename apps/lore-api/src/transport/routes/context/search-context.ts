import { z } from "zod";
import type { Pool } from "pg";
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
import {
  KnowledgeBackendSchema,
  searchBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";
import { repoContextSettings } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import { utopiaReadsFrom } from "@re-cinq/lore-shared/utopia/utopia-reads.js";
import { utopiaArmOf } from "@re-cinq/lore-shared/project/knowledge/context-assembly-utopia.js";
import { searchDocsSource } from "./search-context-utopia.js";

// The corpus search behind `lore_search_context`. It lives here because the adapter holds no pool (ADR-032): without this route the tool's only path was a substring scan of the caller's local checkout, which answers nothing a natural-language question asks.
const SearchContextResultSchema = z.object({
  results: z.array(
    z.object({
      content: z.string(),
      score: z.number(),
      source_path: z.string().nullable(),
      /** Which store answered; present when Utopia is asked for. */
      backend: z.enum(["lore", "utopia"]).optional(),
    }),
  ),
  /** One line per store asked for that could not answer, e.g. "search_context: no Utopia reader yet"; absent for a Lore-only search. */
  notes: z.array(z.string()).optional(),
});

const SearchContextQuery = z.object({
  query: z.string().min(1),
  team: z.string().optional(),
  limit: clampedLimit.default(8),
  backend: KnowledgeBackendSchema.default("utopia"),
  /** `owner/name`; names the Utopia base and docs source to read. */
  repo: z.string().optional(),
});

type SearchContextResult = z.infer<
  typeof SearchContextResultSchema
>["results"][number];

type SearchContextQuery = z.infer<typeof SearchContextQuery>;

export function searchContextRoute(getPool: () => Pool | null): ServerRoute {
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
    handler: (request, h) => serveSearchContext(getPool(), request, h),
  };
}

async function serveSearchContext(
  pool: Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { query, team, limit, backend, repo } =
    request.query as SearchContextQuery;
  const arm = await utopiaArmFor(pool, repo);
  const labelLore = backend === "both" ? labelledLore : toWire;
  const { results, notes } = await searchBackend(
    backend,
    "search_context",
    async () =>
      (await searchWithOrgSharedFallback(query, team, limit)).map(labelLore),
    arm && (() => searchDocsSource(arm, query, limit)),
  );

  return h.response(notes.length > 0 ? { results, notes } : { results });
}

async function utopiaArmFor(pool: Pool | null, repo: string | undefined) {
  const { utopiaMirror } = await repoContextSettings(pool, repo);

  return utopiaArmOf(utopiaReadsFrom(process.env), utopiaMirror);
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

function toWire(result: SearchResult): SearchContextResult {
  const filePath = result.metadata.file_path;

  return {
    content: result.content,
    // pg returns numeric as a STRING. Passed through, the wire says `score: "0.0163…"` while the schema promises a number, and the adapter's renderer calls .toFixed on it and throws.
    score: Number(result.rrf_score),
    source_path: typeof filePath === "string" ? filePath : null,
  };
}

function labelledLore(result: SearchResult): SearchContextResult {
  return { ...toWire(result), backend: "lore" };
}
