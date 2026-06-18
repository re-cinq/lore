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
    `Searches the repo/org ingested-document corpus (CLAUDE.md, ADRs, team docs, specs) and returns the raw matching passages as source-scored snippets, not a synthesized bundle. When a database is reachable this runs hybrid vector+BM25 retrieval (fused by Reciprocal Rank Fusion over the team or org_shared chunk schema); with no DB it degrades to a deterministic case-insensitive substring scan of local .md files, so it works before any ingest has run. Runs against the shared-DB backend directly and never proxies to LORE_API_URL; read-only, no mutations.
Use this when you want chunk-level evidence or the exact wording of a convention/ADR and you know it lives in ingested docs. For ONE token-budgeted starting bundle (conventions + ADRs + memories + facts + graph ordered by template) call lore_assemble_context instead — that is the mandatory first call. For past learnings, decisions, corrections, and extracted facts from prior sessions call lore_search_memory. For entity relationships (X uses/owns/depends-on Y) call lore_query_graph.
Returns a single text block: each hit formatted as "**Score:** <rrf>" (DB path) or "**Source:** <relative-path>" (file path) followed by the passage, joined by "---"; or a no-results message.`,
    {
      query: z.string().describe("Natural-language search query, e.g. 'how are pipeline tasks authenticated'. Required."),
      team: z.string().optional().describe("Scope. On the DB path: a Postgres team schema name (e.g. 'platform'); an empty/no-result team transparently retries against 'org_shared'. On the file-fallback path: a teams/<name> subdirectory under CONTEXT_PATH; an unknown subtree returns a 'search path not found' error. Omit to search the org-wide org_shared corpus; when omitted the repo is auto-detected from the git remote for advisory stderr logging only (it does not scope the search)."),
      limit: z.number().default(8).describe("Maximum number of passages to return, e.g. 5. Defaults to 8 when omitted."),
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
    `Assembles ONE token-budgeted, template-ordered context block for a task by retrieving from every source at once (repo conventions/docs, ADRs, memories, facts, episodes, and graph relationships) and emitting a single provenance-tagged text block an LLM consumes directly. This is the mandatory first call when starting a task; prefer it over hand-stitching the narrower retrieval tools. When LORE_DB_HOST is set it reads the local Postgres directly; otherwise it proxies GET /api/context to the shared cloud backend (LORE_API_URL + LORE_INGEST_TOKEN) through a 600s read-through cache. The max_tokens, agent_id, and cross_repo arguments and the settings.cross_repo fallback take effect only on the direct-DB path; on the proxy (local/no-DB) path only query, template, and repo are forwarded and the rest are ignored. Read-only, no mutations; records a latency row via trackLatency.
Use lore_search_context instead when you want raw matching passages/exact wording from ingested docs rather than a synthesized bundle. Use lore_search_memory for past learnings, decisions, and extracted facts across prior sessions. Use lore_query_graph for structured entity relationships. Those three are the building blocks this tool already combines.
On the direct-DB path the block is prefixed with an HTML comment carrying template/sections/tokens metadata, and returns "No relevant context found for this query." when every source is empty. On the proxy path the API text is returned as-is (no template/sections/tokens comment), optionally prefixed with a "<!-- lore-cache: HIT/STALE -->" marker; a reachable-but-empty backend yields an empty block. Never throws.`,
    {
      query: z.string().describe("Natural-language description of the context needed, e.g. 'implement auth middleware' or 'review PR #42'. Drives retrieval and ranking across all sources. Required."),
      template: z.string().default("default").describe("Section-ordering/budget profile; recognized values are 'default' | 'review' | 'implementation' | 'research'. Not validated — an unrecognized value silently falls back to the 'default' template. Picks which sources are prioritized. Note: the per-template default budget (e.g. research's 16000) is NOT applied automatically — max_tokens always defaults to 8000, so pass max_tokens explicitly to raise it. Defaults to 'default'."),
      max_tokens: z.number().default(8000).describe("Token budget for the assembled block; floor 2000, raise to ~16000 for research-heavy queries, e.g. 12000. Content over budget is truncated and the section marked truncated. Direct-DB path only; ignored when proxying to LORE_API_URL. Defaults to 8000 when omitted."),
      repo: z.string().optional().describe("Target repo as 'owner/repo', e.g. 're-cinq/lore'. Auto-detected from the git remote when omitted."),
      agent_id: z.string().optional().describe("Overrides the resolved agent id used to scope memories/facts, e.g. 'agent-7f3a'. Omit to use the ambient agent id (env, ~/.lore/agent-id, or auto-generated). Direct-DB path only; ignored when proxying to LORE_API_URL."),
      cross_repo: z.boolean().default(false).describe("When true, also pull context from linked repos in the org, e.g. true. Defaults to false; if false but the repo's settings.cross_repo is true, cross-repo is still enabled. Direct-DB path only; ignored when proxying to LORE_API_URL."),
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
            const params = new URLSearchParams({ query, template, repo: resolvedRepo });
            const proxied = await withReadCache(
              { tool: "lore_assemble_context", args: { query, template, repo: resolvedRepo }, repo: resolvedRepo || undefined, ttlSeconds: 600 },
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
