import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";
import {
  hybridSearch,
  isDbAvailable,
} from "@re-cinq/lore-server-core/platform/db.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { traceRetrieval } from "@re-cinq/lore-server-core/platform/otel.js";
import {
  trackLatency,
  proxyGetApi,
  withReadCache,
  unreachableError,
  deniedError,
  textResult,
} from "./deps.js";
import { updateBanner } from "../../features/update/mcp-update.js";

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/** Hybrid vector+BM25 search over the team schema, falling back to org_shared when the team has no hits. */
async function searchDbContext(
  query: string,
  team: string | undefined,
  limit: number,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const schema = team || "org_shared";
  let results = await hybridSearch(query, schema, limit);

  if (results.length === 0 && team && team !== "org_shared") {
    results = await hybridSearch(query, "org_shared", limit);
  }

  traceRetrieval({
    query,
    namespace: schema,
    topScore: results[0]?.rrf_score || 0,
    resultCount: results.length,
  });

  if (results.length === 0) {
    return textResult(`No results for "${query}".`);
  }
  const text = results
    .map((r) => `**Score:** ${r.rrf_score.toFixed(3)}\n\n${r.content}`)
    .join("\n\n---\n\n");

  return textResult(text);
}

interface ParagraphScan {
  file: string;
  raw: string;
  lowerQuery: string;
  limit: number;
}

function appendParagraphMatches(
  results: { source: string; paragraph: string }[],
  scan: ParagraphScan,
): void {
  for (const para of scan.raw.split(/\n{2,}/)) {
    if (results.length >= scan.limit) {
      return;
    }

    if (para.toLowerCase().includes(scan.lowerQuery)) {
      results.push({
        source: relative(CONTEXT_PATH, scan.file),
        paragraph: para.trim(),
      });
    }
  }
}

/** File-based fallback: substring-scans each file's paragraphs until `limit` matches. */
function collectMatchingParagraphs(
  files: string[],
  lowerQuery: string,
  limit: number,
): { source: string; paragraph: string }[] {
  const results: { source: string; paragraph: string }[] = [];

  for (const file of files) {
    const raw = readFileSafe(file);

    if (!raw) {
      continue;
    }
    appendParagraphMatches(results, { file, raw, lowerQuery, limit });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const SEARCH_CONTEXT_INPUT = {
  query: z.string().describe("Natural-language search query."),
  team: z
    .string()
    .optional()
    .describe(
      "Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; unknown teams fall back to org_shared on the DB path or return an error on the file path.",
    ),
  limit: z.number().default(8).describe("Maximum passages to return."),
};

const ASSEMBLE_CONTEXT_INPUT = {
  query: z
    .string()
    .describe(
      "Natural-language description of the context needed. Drives retrieval and ranking across all sources.",
    ),
  template: z
    .string()
    .default("default")
    .describe(
      "Section-ordering profile. Recognized values: 'default' | 'review' | 'implementation' | 'research'. Unrecognized values silently fall back to 'default'. Note: template choice does NOT raise the token budget — max_tokens always defaults to 8000 regardless of template, so pass max_tokens explicitly for research queries.",
    ),
  max_tokens: z
    .number()
    .min(2000)
    .default(8000)
    .describe(
      "Token budget for the assembled block; floor 2000. Raise to ~16000 for research-heavy queries. Defaults to 8000.",
    ),
  repo: z
    .string()
    .optional()
    .describe("'owner/repo'. Auto-detected from the git remote when omitted."),
  agent_id: z
    .string()
    .optional()
    .describe("Overrides the ambient agent id used to scope memories/facts."),
  cross_repo: z
    .boolean()
    .default(false)
    .describe(
      "When true, also pulls context from linked repos in the org. Falls back to the repo's settings.cross_repo when false.",
    ),
};

export function registerContextTools(server: McpServer) {
  registerSearchContextTool(server);
  registerAssembleContextTool(server);
}

function registerSearchContextTool(server: McpServer) {
  server.tool(
    "lore_search_context",
    `Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns raw matching passages as source-scored snippets. Uses hybrid vector+BM25 retrieval when a DB is available; falls back to case-insensitive substring scan of local .md files otherwise.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR. For a ONE token-budgeted bundle combining all sources (conventions, ADRs, memories, facts, graph) call lore_assemble_context — that is the mandatory first call. For past learnings, decisions, and extracted facts from prior sessions call lore_search_memory. For entity relationships call lore_query_graph.`,
    SEARCH_CONTEXT_INPUT,
    async ({ query, team, limit }) => {
      // Auto-detects repo from git remote when no team is specified, to scope DB search to its context namespace.
      const detectedRepo = !team ? detectCurrentRepo() : null;

      if (detectedRepo) {
        console.error(
          `[lore] lore_search_context: auto-detected repo ${detectedRepo}`,
        );
      }

      if (await isDbAvailable()) {
        return searchDbContext(query, team, limit);
      }

      // File-based fallback
      const searchRoot = team
        ? join(CONTEXT_PATH, "teams", team)
        : CONTEXT_PATH;

      if (!existsSync(searchRoot)) {
        return textResult(`Error: search path not found at ${searchRoot}.`);
      }
      const pattern = team
        ? join(searchRoot, "**/*.md")
        : join(CONTEXT_PATH, "**/*.md");
      const files = globSync(pattern, { nodir: true });
      const results = collectMatchingParagraphs(
        files,
        query.toLowerCase(),
        limit,
      );

      const topScore = results.length > 0 ? 1.0 : 0.0; // Phase 0: binary score, Phase 1 will be RRF.

      traceRetrieval({
        query,
        namespace: team || "org",
        topScore,
        resultCount: results.length,
      });

      if (results.length === 0) {
        return textResult(`No results found for "${query}".`);
      }
      const text = results
        .map((r) => `**Source:** ${r.source}\n\n${r.paragraph}`)
        .join("\n\n---\n\n");

      return textResult(text);
    },
  );
}

function registerAssembleContextTool(server: McpServer) {
  server.tool(
    "lore_assemble_context",
    `Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.`,
    ASSEMBLE_CONTEXT_INPUT,
    async ({ query, template, max_tokens, repo, agent_id, cross_repo }) => {
      return trackLatency("lore_assemble_context", async () => {
        try {
          // Local stdio mode proxies to GKE through the read-through cache.
          const apiUrl = process.env.LORE_API_URL;
          const apiToken = process.env.LORE_INGEST_TOKEN;

          if (!apiUrl || !apiToken) {
            return textResult(
              "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
            );
          }
          const resolvedRepo = repo || detectCurrentRepo() || "";
          // Only sent when non-default so these extras also seed the cache key, keeping a 16000-token request from being served an 8000-token cached body.
          const extras: Record<string, string> = {};

          if (max_tokens) {
            extras.max_tokens = String(max_tokens);
          }

          if (cross_repo) {
            extras.cross_repo = "true";
          }

          if (agent_id) {
            extras.agent_id = agent_id;
          }
          const params = new URLSearchParams({
            query,
            template,
            repo: resolvedRepo,
            ...extras,
          });
          const proxied = await withReadCache(
            {
              tool: "lore_assemble_context",
              args: { query, template, repo: resolvedRepo, ...extras },
              repo: resolvedRepo || undefined,
              ttlSeconds: 600,
            },
            async () => {
              const r = await proxyGetApi(`/api/context?${params.toString()}`);

              if (!r.ok) {
                return r;
              }
              const body = JSON.parse(r.body) as { text?: string };

              // A reachable backend returning empty context is a real result, not an outage — return as-is rather than serving a stale, mislabeled fallback.
              return { ok: true as const, body: body.text ?? "" };
            },
          );

          if (proxied.ok) {
            const banner = await updateBanner();

            return textResult(banner + proxied.body);
          }

          if (proxied.reason === "unreachable") {
            return unreachableError("lore_assemble_context", proxied.detail);
          }

          if (proxied.reason === "denied") {
            return deniedError("lore_assemble_context", proxied.detail);
          }

          return textResult(
            "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured.",
          );
        } catch (err) {
          return textResult(`Error assembling context: ${errorMessage(err)}`);
        }
      });
    },
  );
}
