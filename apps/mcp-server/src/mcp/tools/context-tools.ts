import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";
import { hybridSearch, isDbAvailable } from "@re-cinq/lore-server-core/platform/db.js";
import { isMemoryDbAvailable } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { assembleContext } from "@re-cinq/lore-server-core/features/context/context-assembly.js";
import { resolveCrossRepo } from "@re-cinq/lore-server-core/features/context/cross-repo.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { traceRetrieval } from "@re-cinq/lore-server-core/platform/otel.js";
import { ToolDeps, makeTrackLatency, proxyGetApi, withReadCache, unreachableError, deniedError } from "./deps.js";

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

function readFileSafe(path: string): string | null {
  try { return readFileSync(path, "utf-8"); } catch { return null; }
}

export function registerContextTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;
  const trackLatency = makeTrackLatency(getPool);

  server.tool(
    "lore_search_context",
    `Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns raw matching passages as source-scored snippets. Uses hybrid vector+BM25 retrieval when a DB is available; falls back to case-insensitive substring scan of local .md files otherwise.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR. For a ONE token-budgeted bundle combining all sources (conventions, ADRs, memories, facts, graph) call lore_assemble_context — that is the mandatory first call. For past learnings, decisions, and extracted facts from prior sessions call lore_search_memory. For entity relationships call lore_query_graph.`,
    {
      query: z.string().describe("Natural-language search query."),
      team: z.string().optional().describe("Team schema name to scope the search (e.g. 'platform'). Omit to search org_shared; unknown teams fall back to org_shared on the DB path or return an error on the file path."),
      limit: z.number().default(8).describe("Maximum passages to return."),
    },
    async ({ query, team, limit }) => {
      // Auto-detect repo from git remote when no team is specified.
      // Scopes DB search to the detected repo's context namespace.
      const detectedRepo = !team ? detectCurrentRepo() : null;
      if (detectedRepo) {
        console.error(`[lore] lore_search_context: auto-detected repo ${detectedRepo}`);
      }

      if (await isDbAvailable()) {
        const schema = team || "org_shared";
        let results = await hybridSearch(query, schema, limit);

        // If no results in team schema and we have a detected repo, also search org_shared
        if (results.length === 0 && team && team !== "org_shared") {
          results = await hybridSearch(query, "org_shared", limit);
        }

        traceRetrieval({ query, namespace: schema, topScore: results[0]?.rrf_score || 0, resultCount: results.length });
        if (results.length === 0) return { content: [{ type: "text" as const, text: `No results for "${query}".` }] };
        const text = results.map((r: any) => `**Score:** ${r.rrf_score.toFixed(3)}\n\n${r.content}`).join("\n\n---\n\n");
        return { content: [{ type: "text" as const, text }] };
      }

      // File-based fallback
      const searchRoot = team ? join(CONTEXT_PATH, "teams", team) : CONTEXT_PATH;
      if (!existsSync(searchRoot)) {
        return { content: [{ type: "text" as const, text: `Error: search path not found at ${searchRoot}.` }] };
      }
      const pattern = team ? join(searchRoot, "**/*.md") : join(CONTEXT_PATH, "**/*.md");
      const files = globSync(pattern, { nodir: true });
      const lowerQuery = query.toLowerCase();
      const results: { source: string; paragraph: string }[] = [];

      for (const file of files) {
        const raw = readFileSafe(file);
        if (!raw) continue;
        const paragraphs = raw.split(/\n{2,}/);
        for (const para of paragraphs) {
          if (para.toLowerCase().includes(lowerQuery)) {
            results.push({ source: relative(CONTEXT_PATH, file), paragraph: para.trim() });
            if (results.length >= limit) break;
          }
        }
        if (results.length >= limit) break;
      }

      // Trace the retrieval for observability + gap detection
      const topScore = results.length > 0 ? 1.0 : 0.0; // Phase 0: binary score. Phase 1: RRF score.
      traceRetrieval({
        query,
        namespace: team || "org",
        topScore,
        resultCount: results.length,
      });

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No results found for "${query}".` }] };
      }
      const text = results.map(r => `**Source:** ${r.source}\n\n${r.paragraph}`).join("\n\n---\n\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.tool(
    "lore_assemble_context",
    `Assembles ONE token-budgeted, template-ordered context block by pulling from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, graph relationships) and returning a single provenance-tagged text block. This is the mandatory first call when starting any task — use it before the narrower retrieval tools.
Instead: use lore_search_context for raw passages/exact wording from ingested docs; use lore_search_memory for past learnings, decisions, and extracted facts from prior sessions; use lore_query_graph for entity relationships. Those three are the building blocks this tool already combines.`,
    {
      query: z.string().describe("Natural-language description of the context needed. Drives retrieval and ranking across all sources."),
      template: z.string().default("default").describe("Section-ordering profile. Recognized values: 'default' | 'review' | 'implementation' | 'research'. Unrecognized values silently fall back to 'default'. Note: template choice does NOT raise the token budget — max_tokens always defaults to 8000 regardless of template, so pass max_tokens explicitly for research queries."),
      max_tokens: z.number().default(8000).describe("Token budget for the assembled block; floor 2000. Raise to ~16000 for research-heavy queries. Defaults to 8000."),
      repo: z.string().optional().describe("'owner/repo'. Auto-detected from the git remote when omitted."),
      agent_id: z.string().optional().describe("Overrides the ambient agent id used to scope memories/facts."),
      cross_repo: z.boolean().default(false).describe("When true, also pulls context from linked repos in the org. Falls back to the repo's settings.cross_repo when false."),
    },
    async ({ query, template, max_tokens, repo, agent_id, cross_repo }) => {
      return trackLatency('lore_assemble_context', async () => {
        try {
          const dbPoolRef = getPool();
          if (!isMemoryDbAvailable()) {
            // Local stdio mode: proxy to GKE through the read-through cache.
            const apiUrl = process.env.LORE_API_URL;
            const apiToken = process.env.LORE_INGEST_TOKEN;
            if (!apiUrl || !apiToken) {
              return { content: [{ type: "text" as const, text: "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured." }] };
            }
            const resolvedRepo = repo || detectCurrentRepo() || "";
            // Forward the knobs the backend honors. cross_repo=false is the
            // no-op default (the server resolves the settings fallback), so it
            // is only sent when true. The same extras seed the cache key so a
            // 16000-token request is never served an 8000-token cached body.
            const extras: Record<string, string> = {};
            if (max_tokens) extras.max_tokens = String(max_tokens);
            if (cross_repo) extras.cross_repo = "true";
            if (agent_id) extras.agent_id = agent_id;
            const params = new URLSearchParams({ query, template, repo: resolvedRepo, ...extras });
            const proxied = await withReadCache(
              { tool: "lore_assemble_context", args: { query, template, repo: resolvedRepo, ...extras }, repo: resolvedRepo || undefined, ttlSeconds: 600 },
              async () => {
                const r = await proxyGetApi(`/api/context?${params.toString()}`);
                if (!r.ok) return r;
                const data = JSON.parse(r.body) as { text?: string };
                // A reachable backend that returns empty context is a real
                // (empty) result, not an outage — return it as-is rather than
                // forcing a stale, mislabeled "backend unreachable" serve.
                return { ok: true as const, body: data.text ?? "" };
              },
            );
            if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
            if (proxied.reason === "unreachable") return unreachableError("lore_assemble_context", proxied.detail);
            if (proxied.reason === "denied") return deniedError("lore_assemble_context", proxied.detail);
            return { content: [{ type: "text" as const, text: "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured." }] };
          }
          const enableCrossRepo = await resolveCrossRepo(dbPoolRef, repo, cross_repo);
          const result = await assembleContext(dbPoolRef, query, template, max_tokens, repo, agent_id, enableCrossRepo);
          if (!result.text || result.text.trim().length === 0) {
            return { content: [{ type: "text" as const, text: "No relevant context found for this query." }] };
          }
          const meta = `<!-- context: template=${template}, sections=${result.sections.length}, tokens=${result.sections.reduce((s, r) => s + r.tokens, 0)} -->\n\n`;
          return { content: [{ type: "text" as const, text: meta + result.text }] };
        } catch (err: any) {
          return { content: [{ type: "text" as const, text: `Error assembling context: ${err.message}` }] };
        }
      });
    }
  );
}
