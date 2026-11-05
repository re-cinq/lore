import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { traceRetrieval } from "@re-cinq/lore-server-core/platform/otel.js";
import {
  textResult,
  proxyGetApi,
  ASSEMBLY_PROXY_LIMITS,
} from "../shared/deps.js";
import { proxyRefusal } from "../shared/render-proxied.js";
import {
  invalidRepoRefusal,
  NO_REPO_GIVEN,
  repoParam,
  resolveRepo,
  type ServerMode,
} from "../shared/repo-scope.js";
import { backendParam } from "../shared/backend-param.js";
import {
  apiAnswer,
  apiGetUrl,
  type ApiAnswer,
  type ApiQuery,
} from "../../api/api-types.js";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const SEARCH_CONTEXT_INPUT = {
  query: z.string().describe("Natural-language search query."),
  team: z
    .string()
    .optional()
    .describe(
      "Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; an unknown team falls back to org_shared.",
    ),
  limit: z.number().default(8).describe("Maximum passages to return."),
  backend: backendParam,
};

export function registerSearchContextTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_search_context",
    `Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns raw matching passages as source-scored snippets. Uses hybrid vector+BM25 retrieval over the ingested corpus, through the Lore API.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR. For a ONE token-budgeted bundle combining all sources (conventions, ADRs, memories, facts, graph) call lore_assemble_context — that is the mandatory first call. For past learnings, decisions, and extracted facts from prior sessions call lore_search_memory. For entity relationships call lore_query_graph.`,
    { ...SEARCH_CONTEXT_INPUT, repo: repoParam(mode) },
    (search) => searchContextFor(search, mode),
  );
}

/** One corpus search as the tool takes it: the API's own query. */
type CorpusSearch = ApiQuery<"/api/search-context">;

type Passage = ApiAnswer<"/api/search-context">["results"][number];

async function searchContextFor(requested: CorpusSearch, mode: ServerMode) {
  const refusal = repoRefusal(requested.repo, mode);

  if (refusal) {
    return textResult(refusal);
  }
  const search = withDetectedRepo(requested, mode);

  logDetectedRepo(search.team, mode);

  return searchApiContext(search);
}

/** A repo that is not owner/name, or none at all in the shared gateway, is refused before anything is read. */
function repoRefusal(
  repo: string | undefined,
  mode: ServerMode,
): string | null {
  return (
    invalidRepoRefusal(repo) ??
    (mode === "agent" && !repo ? NO_REPO_GIVEN : null)
  );
}

function withDetectedRepo(search: CorpusSearch, mode: ServerMode) {
  return { ...search, repo: resolveRepo(search.repo, mode) ?? undefined };
}

// Auto-detects repo from git remote when no team is specified, to scope the search to its context namespace.
function logDetectedRepo(team: string | undefined, mode: ServerMode): void {
  const detectedRepo = !team ? resolveRepo(undefined, mode) : null;

  if (detectedRepo) {
    console.error(
      `[lore] lore_search_context: auto-detected repo ${detectedRepo}`,
    );
  }
}

const CORPUS_READ = {
  op: "searching the context corpus",
  subject: "context passages",
  toolName: "lore_search_context",
};

/** The corpus search as the API answers it; the adapter holds no pool (ADR-032). */
async function searchApiContext(search: CorpusSearch) {
  const { query, team } = search;
  const proxied = await proxyGetApi(corpusUrl(search), ASSEMBLY_PROXY_LIMITS);

  if (!proxied.ok) {
    return proxyRefusal(proxied, CORPUS_READ);
  }
  const { results, notes = [] } = apiAnswer(
    "/api/search-context",
    proxied.body,
  );

  traceRetrieval({
    query,
    namespace: team || "org_shared",
    topScore: results[0]?.score ?? 0,
    resultCount: results.length,
  });

  return withNotes(renderScoredPassages(query, results), notes);
}

function corpusUrl({ query, limit, team, backend, repo }: CorpusSearch) {
  return apiGetUrl("/api/search-context", {
    query,
    limit,
    team,
    backend,
    repo,
  });
}

function renderScoredPassages(
  query: string,
  results: Passage[],
): { content: Array<{ type: "text"; text: string }> } {
  if (results.length === 0) {
    return textResult(`No results for "${query}".`);
  }
  const text = results
    .map((r) => `**Score:** ${r.score.toFixed(3)}\n\n${r.content}`)
    .join("\n\n---\n\n");

  return textResult(text);
}

/** The API's word on a store it could not read (e.g. "search_context: no Utopia reader yet"), after the passages. */
function withNotes(
  rendered: { content: Array<{ type: "text"; text: string }> },
  notes: string[],
): { content: Array<{ type: "text"; text: string }> } {
  const [{ text }] = rendered.content;

  return notes.length > 0
    ? textResult([text, ...notes].join("\n\n"))
    : rendered;
}
