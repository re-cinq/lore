import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";
import { hybridSearch, isDbAvailable } from "../../platform/db.js";
import { isMemoryDbAvailable } from "../../features/memory/memory.js";
import { assembleContext } from "../../features/context/context-assembly.js";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { traceRetrieval } from "../../platform/otel.js";
import { ToolDeps, makeTrackLatency } from "./deps.js";

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

function readFileSafe(path: string): string | null {
  try { return readFileSync(path, "utf-8"); } catch { return null; }
}

export function registerContextTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;
  const trackLatency = makeTrackLatency(getPool);

  server.tool(
    "search_context",
    "Naive case-insensitive text search across all .md files in the context repository.",
    {
      query: z.string().describe("Search query in natural language."),
      team: z.string().optional().describe("Scope search to a specific team. If omitted, searches org-wide."),
      limit: z.number().default(8).describe("Maximum results to return."),
    },
    async ({ query, team, limit }) => {
      // Auto-detect repo from git remote when no team is specified.
      // Scopes DB search to the detected repo's context namespace.
      const detectedRepo = !team ? detectCurrentRepo() : null;
      if (detectedRepo) {
        console.error(`[lore] search_context: auto-detected repo ${detectedRepo}`);
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
    "assemble_context",
    "Retrieve and assemble context from all sources (repo, ADRs, memories, facts, episodes, graph) into a single structured block optimized for LLM consumption. Replaces multiple get_context + search_memory + get_adrs calls. Uses configurable templates for task-type-specific context ordering.",
    {
      query: z.string().describe("What context is needed (e.g. 'implement auth middleware', 'review PR #42')."),
      template: z.string().default("default").describe('Template name: "default", "review", "implementation", "research".'),
      max_tokens: z.number().default(8000).describe("Maximum token budget for assembled context (min 2000). Raise up to ~16000 for research-heavy queries."),
      repo: z.string().optional().describe("Target repo (e.g. 'owner/repo'). Auto-detected if omitted."),
      agent_id: z.string().optional().describe("Override agent ID."),
      cross_repo: z.boolean().default(false).describe("Include context from other repos in the org."),
    },
    async ({ query, template, max_tokens, repo, agent_id, cross_repo }) => {
      return trackLatency('assemble_context', async () => {
        try {
          const dbPoolRef = getPool();
          if (!isMemoryDbAvailable()) {
            // Proxy to GKE
            const apiUrl = process.env.LORE_API_URL;
            const apiToken = process.env.LORE_INGEST_TOKEN;
            if (apiUrl && apiToken) {
              try {
                const resolvedRepo = repo || detectCurrentRepo() || "";
                const params = new URLSearchParams({ query, template, repo: resolvedRepo });
                const res = await fetch(`${apiUrl}/api/context?${params}`, {
                  headers: { "Authorization": `Bearer ${apiToken}` },
                });
                if (res.ok) {
                  const data = await res.json() as any;
                  if (data.text) {
                    const meta = `<!-- context: proxied from GKE, template=${template} -->\n\n`;
                    return { content: [{ type: "text" as const, text: meta + data.text }] };
                  }
                }
              } catch { /* fall through */ }
            }
            return { content: [{ type: "text" as const, text: "Context assembly requires PostgreSQL or LORE_API_URL. Neither is configured." }] };
          }
          // Resolve cross_repo: explicit param wins, then check repo settings
          let enableCrossRepo = cross_repo;
          if (!enableCrossRepo && repo && dbPoolRef) {
            try {
              const { rows } = await dbPoolRef.query(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
              if (rows[0]?.settings?.cross_repo === true) enableCrossRepo = true;
            } catch { /* non-fatal */ }
          }
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
