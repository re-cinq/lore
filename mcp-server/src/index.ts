import { initOtel, traceRetrieval, shutdownOtel } from "./otel.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";
import pg from "pg";
import {
  hybridSearch,
  getContextFromDb,
  getAdrsFromDb,
  getFilePrHistory,
  isAlloyDbAvailable,
  setPool,
  getHealthStatus,
} from "./db.js";

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

function readFileSafe(path: string): string | null {
  try { return readFileSync(path, "utf-8"); } catch { return null; }
}

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w_]*):\s*(.+)$/);
    if (kv) {
      const val = kv[2].trim();
      // Handle YAML arrays: [a, b] or bare value
      if (val.startsWith("[") && val.endsWith("]")) {
        meta[kv[1]] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^['"]|['"]$/g, ""));
      } else {
        meta[kv[1]] = val.replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return { meta, body: match[2] };
}

const server = new McpServer({ name: "@re-cinq/lore-mcp", version: "0.1.0" });

// --- get_context ---
server.tool(
  "get_context",
  "Returns merged CLAUDE.md content for the org and optionally a specific team.",
  { team: z.string().optional().describe('Team name (e.g., "payments"). If omitted, returns org-level context only.') },
  async ({ team }) => {
    if (await isAlloyDbAvailable()) {
      const results = await getContextFromDb(team || "org_shared");
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No context documents found for "${team || "org_shared"}".` }] };
      }
      const text = results.map((r: any) => r.content).join("\n\n---\n\n");
      return { content: [{ type: "text" as const, text }] };
    }

    // File-based fallback
    const rootPath = join(CONTEXT_PATH, "CLAUDE.md");
    const root = readFileSafe(rootPath);
    if (!root) {
      return { content: [{ type: "text" as const, text: `Error: CLAUDE.md not found at ${rootPath}. Ensure CONTEXT_PATH is set or run install.sh.` }] };
    }
    let text = `# Org Context\n\n${root}`;
    if (team) {
      const teamPath = join(CONTEXT_PATH, "teams", team, "CLAUDE.md");
      const teamContent = readFileSafe(teamPath);
      if (teamContent) {
        text += `\n\n---\n\n# Team: ${team}\n\n${teamContent}`;
      } else {
        text += `\n\n---\n\n_Note: No CLAUDE.md found for team "${team}" at ${teamPath}._`;
      }
    }
    return { content: [{ type: "text" as const, text }] };
  }
);

// --- get_adrs ---
server.tool(
  "get_adrs",
  "Returns ADRs filtered by domain and/or status, sorted by adr_number descending.",
  {
    domain: z.string().optional().describe('Filter by domain (e.g., "payments"). Matches ADR frontmatter domains array.'),
    status: z.enum(["proposed", "accepted", "deprecated", "superseded"]).default("accepted").describe("ADR status filter. Defaults to accepted."),
  },
  async ({ domain, status }) => {
    if (await isAlloyDbAvailable()) {
      const results = await getAdrsFromDb(domain || "", status);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: domain ? `No ADRs found for domain "${domain}" with status "${status}".` : `No ADRs found with status "${status}".` }] };
      }
      const text = results.map((r: any) => r.content).join("\n\n---\n\n");
      return { content: [{ type: "text" as const, text }] };
    }

    // File-based fallback
    const adrsDir = join(CONTEXT_PATH, "adrs");
    if (!existsSync(adrsDir)) {
      return { content: [{ type: "text" as const, text: `Error: adrs/ directory not found at ${adrsDir}.` }] };
    }
    let files: string[];
    try { files = readdirSync(adrsDir).filter(f => f.endsWith(".md")); } catch {
      return { content: [{ type: "text" as const, text: `Error: could not read adrs/ directory.` }] };
    }

    const adrs: { num: number; content: string }[] = [];
    const allDomains = new Set<string>();

    for (const file of files) {
      const raw = readFileSafe(join(adrsDir, file));
      if (!raw) continue;
      const { meta } = parseFrontmatter(raw);
      const metaStatus = (meta.status as string || "").toLowerCase();
      const metaDomains: string[] = Array.isArray(meta.domains) ? meta.domains.map(String) : [];
      metaDomains.forEach(d => allDomains.add(d));

      if (metaStatus !== status) continue;
      if (domain && !metaDomains.some(d => d.toLowerCase() === domain.toLowerCase())) continue;
      const num = typeof meta.adr_number === "string" ? parseInt(meta.adr_number, 10) : (meta.adr_number as number ?? 0);
      adrs.push({ num, content: raw });
    }

    adrs.sort((a, b) => b.num - a.num);

    if (adrs.length === 0) {
      const note = domain
        ? `No ADRs found for domain "${domain}" with status "${status}". Available domains: ${[...allDomains].join(", ") || "none"}.`
        : `No ADRs found with status "${status}".`;
      return { content: [{ type: "text" as const, text: note }] };
    }
    return { content: [{ type: "text" as const, text: adrs.map(a => a.content).join("\n\n---\n\n") }] };
  }
);

// --- search_context ---
server.tool(
  "search_context",
  "Naive case-insensitive text search across all .md files in the context repository.",
  {
    query: z.string().describe("Search query in natural language."),
    team: z.string().optional().describe("Scope search to a specific team. If omitted, searches org-wide."),
    limit: z.number().default(8).describe("Maximum results to return."),
  },
  async ({ query, team, limit }) => {
    if (await isAlloyDbAvailable()) {
      const schema = team || "org_shared";
      const results = await hybridSearch(query, schema, limit);
      // trace with actual RRF score
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

// --- Start server ---
async function main() {
  await initOtel();

  // Initialize PostgreSQL connection pool if LORE_DB_HOST is set
  if (process.env.LORE_DB_HOST) {
    const dbHost = process.env.LORE_DB_HOST;
    const dbPool = new pg.Pool({
      host: dbHost,
      port: parseInt(process.env.LORE_DB_PORT || "5432", 10),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "postgres",
      password: process.env.LORE_DB_PASSWORD,
    });
    setPool(dbPool);
    console.error(`[lore] Database mode: PostgreSQL at ${dbHost}`);
  } else {
    console.error("[lore] Database mode: local files (LORE_DB_HOST not set)");
  }

  const mode = process.env.MCP_TRANSPORT || "stdio";

  if (mode === "http") {
    const port = parseInt(process.env.PORT || "3000", 10);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    const httpServer = createServer(async (req, res) => {
      if (req.url === "/mcp" || req.url === "/mcp/") {
        await transport.handleRequest(req, res);
      } else if (req.url === "/healthz") {
        const health = await getHealthStatus();
        const status = health.connected || !process.env.LORE_DB_HOST ? "ok" : "error";
        const code = status === "error" ? 503 : 200;
        res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify({ status, database: health }));
      } else {
        res.writeHead(404).end();
      }
    });
    await server.connect(transport);
    httpServer.listen(port, () => {
      console.log(`MCP server (HTTP) listening on :${port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
