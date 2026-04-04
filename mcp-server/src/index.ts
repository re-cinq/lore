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
  getQueryEmbedding,
} from "./db.js";
import { resolveAgentId } from "./agent-id.js";
import {
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
  setMemoryPool,
  isMemoryDbAvailable,
  sharedWrite,
  sharedRead,
  createSnapshot,
  restoreSnapshot,
  agentHealth,
  agentStats,
} from "./memory.js";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "./memory-file.js";
import { searchMemories } from "./memory-search.js";
import { extractFacts, extractFactsFromEpisode } from "./facts.js";
import { extractAndUpdateGraph, queryLiveGraph } from "./graph.js";
import { assembleContext, loadTemplates } from "./context-assembly.js";
import { createHash } from "node:crypto";
import {
  createTask,
  getTask,
  listTasks,
  cancelTask,
  markTaskMerged,
  handleReviewResult,
  setPipelinePool,
} from './pipeline.js';
import { loadTaskTypes, getTaskTypes } from './pipeline-config.js';
import {
  parseTasks,
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from './tasks.js';
import {
  getOnboardedReposWithCounts,
  getAvailableRepos,
  onboardRepo,
  checkOnboardingPRs,
} from './repo-onboard.js';
import { detectCurrentRepo } from './repo-detect.js';
import { ingestFiles } from './ingest.js';

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

// Module-level pool ref for tools that take pool as argument
let dbPoolRef: any = null;

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

// --- Latency tracking helper ---
async function trackLatency(tool: string, fn: () => Promise<any>): Promise<any> {
  const start = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - start;
  if (dbPoolRef) {
    dbPoolRef.query(
      `INSERT INTO memory.audit_log (agent_id, operation, metadata) VALUES ($1, $2, $3)`,
      ['system', tool, JSON.stringify({ latency_ms: latencyMs })],
    ).catch(() => {});
  }
  return result;
}

// --- get_context ---
server.tool(
  "get_context",
  "Returns context (CLAUDE.md, ADRs, conventions) for the current repo. Auto-detects which repo you're in from the git remote.",
  { team: z.string().optional().describe('Team name (e.g., "payments"). Usually auto-detected — only set if you need a specific team.') },
  async ({ team }) => {
    const detectedRepo = detectCurrentRepo();
    if (detectedRepo) {
      console.error(`[lore] get_context: auto-detected repo ${detectedRepo}`);
    }

    // DB path: query by repo first, fall back to team schema
    if (await isAlloyDbAvailable()) {
      // Try repo-specific context first
      if (detectedRepo) {
        try {
          const { rows } = await dbPoolRef.query(
            `SELECT content FROM org_shared.chunks WHERE repo = $1 AND content_type = 'doc' ORDER BY ingested_at DESC`,
            [detectedRepo],
          );
          if (rows.length > 0) {
            const text = rows.map((r: any) => r.content).join("\n\n---\n\n");
            return { content: [{ type: "text" as const, text }] };
          }
        } catch {}
      }
      // Fall back to team/org schema
      const results = await getContextFromDb(team || "org_shared");
      if (results.length > 0) {
        const text = results.map((r: any) => r.content).join("\n\n---\n\n");
        return { content: [{ type: "text" as const, text }] };
      }
    }

    // Proxy to GKE: fetch repo context from the vector store
    const apiUrl = process.env.LORE_API_URL;
    const apiToken = process.env.LORE_INGEST_TOKEN;
    if (apiUrl && apiToken && detectedRepo) {
      try {
        const res = await fetch(`${apiUrl}/api/context?repo=${encodeURIComponent(detectedRepo)}`, {
          headers: { "Authorization": `Bearer ${apiToken}` },
        });
        if (res.ok) {
          const data = await res.json() as any;
          if (data.text) {
            return { content: [{ type: "text" as const, text: data.text }] };
          }
        }
      } catch {}
    }

    // File-based fallback: read CLAUDE.md from the CURRENT working directory (the repo the dev is in)
    const cwdClaudeMd = readFileSafe(join(process.cwd(), "CLAUDE.md"));
    if (cwdClaudeMd) {
      let text = cwdClaudeMd;
      // Also load org-level context from Lore
      const orgContext = readFileSafe(join(CONTEXT_PATH, "CLAUDE.md"));
      if (orgContext && CONTEXT_PATH !== process.cwd()) {
        text = `# Org Context\n\n${orgContext}\n\n---\n\n# Repo Context\n\n${text}`;
      }
      return { content: [{ type: "text" as const, text }] };
    }

    // Last resort: Lore's own CLAUDE.md
    const root = readFileSafe(join(CONTEXT_PATH, "CLAUDE.md"));
    if (!root) {
      return { content: [{ type: "text" as const, text: "No CLAUDE.md found in current repo or Lore context directory." }] };
    }
    return { content: [{ type: "text" as const, text: root }] };
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
    // Auto-detect repo from git remote when no team is specified.
    // Scopes DB search to the detected repo's context namespace.
    const detectedRepo = !team ? detectCurrentRepo() : null;
    if (detectedRepo) {
      console.error(`[lore] search_context: auto-detected repo ${detectedRepo}`);
    }

    if (await isAlloyDbAvailable()) {
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

// --- Memory proxy helper (for local mode without DB) ---

async function proxyMemory(action: string, params: Record<string, any>): Promise<string | null> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;
  if (!apiUrl || !apiToken) return null;
  try {
    const res = await fetch(`${apiUrl}/api/memory`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    if (!res.ok) return null;
    return JSON.stringify(await res.json());
  } catch { return null; }
}

// --- Memory tools ---

server.tool(
  "write_memory",
  "Store a memory scoped to the current repo. Shared with every developer working in the same repo. Use for decisions, conventions, corrections, and session summaries.",
  {
    key: z.string().describe("Memory key (e.g. 'auth-pattern', 'session-summary/2026-03-30')"),
    value: z.string().describe("Memory value (text)"),
    agent_id: z.string().optional().describe("Override agent ID."),
    ttl: z.number().optional().describe("Time-to-live in seconds. Omit for permanent."),
    extract_facts: z.boolean().optional().describe("Extract individual facts from value (async)."),
  },
  async ({ key, value, agent_id, ttl, extract_facts }) => {
    try {
      const repo = detectCurrentRepo() || undefined;
      const embedding = await getQueryEmbedding(value);
      if (isMemoryDbAvailable()) {
        const result = await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo);
        if (extract_facts) {
          import("./memory.js").then(({ getMemoryPool }) => {
            const p = getMemoryPool();
            if (p) {
              p.query(
                `SELECT id FROM memory.memories WHERE key = $1 AND (repo = $2 OR agent_id = $3) ORDER BY version DESC LIMIT 1`,
                [key, repo || '', resolveAgentId(agent_id)]
              ).then((r: any) => {
                if (r.rows[0]?.id) extractFacts(r.rows[0].id, value, p).catch(() => {});
              });
            }
          });
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      // Proxy to GKE if available
      const proxied = await proxyMemory("write", { key, value, agent_id: agent_id || resolveAgentId(), ttl, repo });
      if (proxied) return { content: [{ type: "text" as const, text: proxied }] };
      // File fallback (local only, not shared)
      const result = await writeMemoryFile(key, value, agent_id, ttl);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error writing memory: ${err.message}` }] };
    }
  }
);

server.tool(
  "read_memory",
  "Retrieve a specific memory by key. Supports version history.",
  {
    key: z.string().describe("Memory key to read."),
    agent_id: z.string().optional(),
    version: z.string().optional().describe('"all" for full history, or specific version number.'),
  },
  async ({ key, agent_id, version }) => {
    try {
      const ver = version === "all" ? "all" : version ? Number(version) : undefined;
      if (isMemoryDbAvailable()) {
        const result = await readMemory(key, agent_id, ver);
        if (!result) return { content: [{ type: "text" as const, text: `Memory "${key}" not found.` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const proxied = await proxyMemory("read", { key, agent_id: agent_id || resolveAgentId(), version });
      if (proxied) return { content: [{ type: "text" as const, text: proxied }] };
      const result = await readMemoryFile(key, agent_id, ver);
      if (!result) return { content: [{ type: "text" as const, text: `Memory "${key}" not found.` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error reading memory: ${err.message}` }] };
    }
  }
);

server.tool(
  "delete_memory",
  "Soft-delete a memory (preserved in history but excluded from search).",
  {
    key: z.string().describe("Memory key to delete."),
    agent_id: z.string().optional(),
  },
  async ({ key, agent_id }) => {
    try {
      if (isMemoryDbAvailable()) {
        const result = await deleteMemory(key, agent_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      const proxied = await proxyMemory("delete", { key, agent_id: agent_id || resolveAgentId() });
      if (proxied) return { content: [{ type: "text" as const, text: proxied }] };
      const result = await deleteMemoryFile(key, agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error deleting memory: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_memories",
  "List memories for the current repo. Auto-detects which repo you're in.",
  {
    agent_id: z.string().optional(),
    limit: z.number().default(50).describe("Max results."),
    offset: z.number().default(0).describe("Pagination offset."),
  },
  async ({ agent_id, limit, offset }) => {
    try {
      const repo = detectCurrentRepo() || undefined;
      if (isMemoryDbAvailable()) {
        const result = await listMemories(agent_id, limit, offset, repo);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      const proxied = await proxyMemory("list", { agent_id: agent_id || undefined, limit, repo });
      if (proxied) return { content: [{ type: "text" as const, text: proxied }] };
      const result = await listMemoriesFile(agent_id, limit, offset);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error listing memories: ${err.message}` }] };
    }
  }
);

server.tool(
  "search_memory",
  "Semantic search across all org memories and facts. Returns results ranked by similarity. Facts include temporal validity — only currently valid facts are returned by default.",
  {
    query: z.string().describe("Natural language search query."),
    agent_id: z.string().optional().describe("Scope to agent. Omit for cross-agent search."),
    pool: z.string().optional().describe("Search within a shared pool."),
    limit: z.number().default(10),
    include_invalidated: z.boolean().default(false).describe("Include facts that have been superseded by newer facts. Useful for historical queries."),
    graph_augment: z.boolean().default(false).describe("Enrich results with 1-hop knowledge graph neighbors of detected entities."),
  },
  async ({ query, agent_id, pool, limit, include_invalidated, graph_augment }) => {
    try {
      if (isMemoryDbAvailable()) {
        const results = await searchMemories(
          dbPoolRef,
          query, agent_id, pool, limit, include_invalidated, graph_augment
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      }
      const proxied = await proxyMemory("search", { query, agent_id: agent_id || undefined, pool_name: pool, limit });
      if (proxied) return { content: [{ type: "text" as const, text: proxied }] };
      const results = await searchMemoryFile(query, agent_id, limit);
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error searching memories: ${err.message}` }] };
    }
  }
);

// --- Episode tools ---

server.tool(
  "write_episode",
  "Ingest raw, unstructured text (conversation turn, code review, observation). The system stores it as an episode and automatically extracts searchable facts. Use this for passive knowledge capture — no need to curate what's important.",
  {
    content: z.string().min(1).max(50000).describe("Raw text to ingest (conversation, review, observation)."),
    source: z.string().default("manual").describe('Source tag: "session", "pr-review", "ci", "manual".'),
    ref: z.string().optional().describe('External reference (e.g. "owner/repo#42").'),
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ content, source, ref, agent_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Episodes require PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const agent = resolveAgentId(agent_id);
      const contentHash = createHash("sha256").update(content).digest("hex");
      const embedding = await getQueryEmbedding(content);
      const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

      const { rows } = await dbPoolRef.query(
        `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_id, content_hash) DO NOTHING
         RETURNING id`,
        [agent, content, contentHash, source, ref || null, embeddingStr],
      );

      if (rows.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ status: "duplicate", message: "Episode already ingested." }) }] };
      }

      const episodeId = rows[0].id;

      // Trigger async fact extraction and graph update (don't block the response)
      extractFactsFromEpisode(episodeId, content, agent, dbPoolRef).catch((err) =>
        console.warn(`[episode] Fact extraction failed for ${episodeId}: ${err.message}`),
      );

      // Graph extraction (async, best-effort, requires ANTHROPIC_API_KEY)
      if (process.env.ANTHROPIC_API_KEY) {
        const graphLlmCall = async (prompt: string) => {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': process.env.ANTHROPIC_API_KEY!,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: process.env.LORE_FACT_MODEL || 'claude-sonnet-4-20250514',
              max_tokens: 1024,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
          const json = await res.json() as any;
          return json.content[0].text;
        };
        // Determine repo from ref (e.g. "owner/repo#42" -> "owner/repo")
        const repoFromRef = ref?.match(/^([^#]+)/)?.[1] || null;
        extractAndUpdateGraph(dbPoolRef, content, repoFromRef, episodeId, null, graphLlmCall).catch((err) =>
          console.warn(`[episode] Graph extraction failed for ${episodeId}: ${err.message}`),
        );
      }

      // Audit log
      await dbPoolRef.query(
        `INSERT INTO memory.audit_log (agent_id, operation, metadata)
         VALUES ($1, 'write_episode', $2)`,
        [agent, JSON.stringify({ episode_id: episodeId, source, ref })],
      ).catch(() => {});

      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "ok", episode_id: episodeId, source, ref }) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error writing episode: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_episodes",
  "List recent episodes ingested by an agent. Returns episodes with their extracted fact count.",
  {
    agent_id: z.string().optional().describe("Override agent ID."),
    source: z.string().optional().describe('Filter by source tag (e.g. "pr-review").'),
    limit: z.number().default(20),
  },
  async ({ agent_id, source, limit }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Episodes require PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const agent = resolveAgentId(agent_id);
      const { rows } = await dbPoolRef.query(
        `SELECT e.id, e.source, e.ref, e.created_at,
                LEFT(e.content, 200) as content_preview,
                (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count
         FROM memory.episodes e
         WHERE e.agent_id = $1
           AND ($2::text IS NULL OR e.source = $2)
         ORDER BY e.created_at DESC
         LIMIT $3`,
        [agent, source || null, limit],
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error listing episodes: ${err.message}` }] };
    }
  }
);

// --- Knowledge graph tools ---

server.tool(
  "query_graph",
  "Query the live knowledge graph for entities and their relationships. Returns entities connected by typed edges (uses, owns, depends-on, etc.) with temporal validity.",
  {
    entity: z.string().optional().describe("Entity name to query (e.g. 'auth-service', 'postgres'). Omit to browse recent edges."),
    relation_type: z.string().optional().describe('Filter by relation type: "uses", "owns", "depends-on", "replaced-by", "part-of", "implements".'),
    repo: z.string().optional().describe("Scope to a specific repo."),
    include_invalidated: z.boolean().default(false).describe("Include invalidated (historical) relationships."),
  },
  async ({ entity, relation_type, repo, include_invalidated }) => {
    return trackLatency('query_graph', async () => {
      try {
        if (!isMemoryDbAvailable()) {
          return { content: [{ type: "text" as const, text: "Knowledge graph requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const results = await queryLiveGraph(dbPoolRef, entity, relation_type, repo, include_invalidated);
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: entity ? `No relationships found for "${entity}".` : "Knowledge graph is empty. Write episodes or memories to populate it." }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error querying graph: ${err.message}` }] };
      }
    });
  }
);

// --- Context assembly tools ---

server.tool(
  "assemble_context",
  "Retrieve and assemble context from all sources (repo, ADRs, memories, facts, episodes, graph) into a single structured block optimized for LLM consumption. Replaces multiple get_context + search_memory + get_adrs calls. Uses configurable templates for task-type-specific context ordering.",
  {
    query: z.string().describe("What context is needed (e.g. 'implement auth middleware', 'review PR #42')."),
    template: z.string().default("default").describe('Template name: "default", "review", "implementation", "research".'),
    max_tokens: z.number().default(16000).describe("Maximum token budget for assembled context (min 2000)."),
    repo: z.string().optional().describe("Target repo (e.g. 'owner/repo'). Auto-detected if omitted."),
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ query, template, max_tokens, repo, agent_id }) => {
    return trackLatency('assemble_context', async () => {
      try {
        if (!isMemoryDbAvailable()) {
          return { content: [{ type: "text" as const, text: "Context assembly requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const result = await assembleContext(dbPoolRef, query, template, max_tokens, repo, agent_id);
        if (!result.text) {
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

// --- Shared pool tools ---

server.tool(
  "shared_write",
  "Write a memory to a shared pool visible to all agents in that pool.",
  {
    pool_name: z.string().describe("Name of the shared pool (e.g. 'team-decisions')."),
    key: z.string().describe("Memory key."),
    value: z.string().describe("Memory value (text)."),
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ pool_name, key, value, agent_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Shared pools require PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const embedding = await getQueryEmbedding(value);
      const result = await sharedWrite(pool_name, key, value, agent_id, embedding || undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error writing to shared pool: ${err.message}` }] };
    }
  }
);

server.tool(
  "shared_read",
  "Read memories from a shared pool. Returns a specific key or lists all pool entries.",
  {
    pool_name: z.string().describe("Name of the shared pool."),
    key: z.string().optional().describe("Specific key to read. Omit to list all entries."),
  },
  async ({ pool_name, key }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Shared pools require PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await sharedRead(pool_name, key);
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return { content: [{ type: "text" as const, text: key ? `Key "${key}" not found in pool "${pool_name}".` : `Pool "${pool_name}" is empty or does not exist.` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error reading shared pool: ${err.message}` }] };
    }
  }
);

// --- Snapshot tools ---

server.tool(
  "create_snapshot",
  "Create a point-in-time snapshot of all agent memories for later restoration.",
  {
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ agent_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Snapshots require PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await createSnapshot(agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error creating snapshot: ${err.message}` }] };
    }
  }
);

server.tool(
  "restore_snapshot",
  "Restore agent memories to a previous snapshot state.",
  {
    snapshot_id: z.string().describe("UUID of the snapshot to restore."),
  },
  async ({ snapshot_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Snapshots require PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await restoreSnapshot(snapshot_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error restoring snapshot: ${err.message}` }] };
    }
  }
);

// --- Health & stats tools ---

server.tool(
  "agent_health",
  "Returns health summary for an agent: memory count, last activity, snapshot count.",
  {
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ agent_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Agent health requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await agentHealth(agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error fetching agent health: ${err.message}` }] };
    }
  }
);

server.tool(
  "agent_stats",
  "Returns usage statistics: total memories, facts, searches, and shared pools created.",
  {
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ agent_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Agent stats requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await agentStats(agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error fetching agent stats: ${err.message}` }] };
    }
  }
);

// --- Pipeline tools ---

server.tool(
  "create_pipeline_task",
  "Delegate a task to the Lore Agent on GKE. The agent picks it up, calls an LLM, and creates a PR. Available types: feature-request (PM intent → spec + tasks), onboard (add repo to Lore), general (open-ended), runbook (write ops runbook), implementation (code from spec), gap-fill (draft missing docs), review (review a PR).",
  {
    description: z.string().describe("What should the agent do? Be specific — this is the primary instruction. For feature-request: describe the feature in plain language. For onboard: just the repo name."),
    task_type: z.string().default("general").describe('Task type: "feature-request", "onboard", "general", "runbook", "implementation", "gap-fill", "review".'),
    target_repo: z.string().optional().describe('Target GitHub repository in "owner/repo" format. Auto-detected from git remote if omitted.'),
    context: z.object({
      spec_file: z.boolean().optional(),
      branch: z.string().optional(),
      seed_query: z.string().optional(),
    }).optional().describe("Additional context to pass to the agent."),
  },
  async ({ description: desc, task_type, target_repo, context }) => {
    try {
      if (!desc || !desc.trim()) {
        return { content: [{ type: "text" as const, text: "description is required and cannot be empty" }] };
      }

      // Auto-detect repo from git remote if not specified
      const resolvedRepo = target_repo || detectCurrentRepo() || undefined;

      // When running locally (no DB), proxy to the GKE MCP server
      if (!process.env.LORE_DB_HOST) {
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;
        if (!apiUrl || !apiToken) {
          return { content: [{ type: "text" as const, text: "Task delegation requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh or set them manually." }] };
        }
        const res = await fetch(`${apiUrl}/api/task`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc, task_type, target_repo: resolvedRepo, context }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Remote task creation failed: ${(err as any).error || res.statusText}` }] };
        }
        const result = await res.json() as any;
        const msg = `Task created: ${result.task_id}\nType: ${task_type}\nRepo: ${resolvedRepo || 'default'}\n\nThe agent will pick this up within 30 seconds. A GitHub Issue will be created on the repo, and a PR will follow when the agent finishes. Check status with get_pipeline_status or list_pipeline_tasks.`;
        return { content: [{ type: "text" as const, text: msg }] };
      }

      const validTypes = getTaskTypes();
      const resolvedType = validTypes.includes(task_type) ? task_type : "general";
      const result = await createTask(desc, resolvedType, resolvedRepo, "mcp", context || undefined);
      const msg = `Task created: ${result.task_id}\nType: ${resolvedType}\nRepo: ${resolvedRepo || 'default'}\n\nThe agent will pick this up within 30 seconds. A GitHub Issue will be created on the repo, and a PR will follow when the agent finishes. Check status with get_pipeline_status or list_pipeline_tasks.`;
      return { content: [{ type: "text" as const, text: msg }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error creating pipeline task: ${err.message}` }] };
    }
  }
);

server.tool(
  "get_pipeline_status",
  "Retrieve the current status of a pipeline task, including its full event timeline.",
  {
    task_id: z.string().describe("UUID of the pipeline task."),
  },
  async ({ task_id }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;
        if (!apiUrl || !apiToken) return { content: [{ type: "text" as const, text: "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access." }] };
        const res = await fetch(`${apiUrl}/api/task/${task_id}`, { headers: { "Authorization": `Bearer ${apiToken}` } });
        if (!res.ok) return { content: [{ type: "text" as const, text: `Remote error: ${res.statusText}` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
      }
      const task = await getTask(task_id);
      if (!task) return { content: [{ type: "text" as const, text: `task not found: ${task_id}` }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "get_pr_status",
  "Fetch live PR state from GitHub for a given repo and PR number. Returns draft/open/checks-failing/changes-requested/approved/merged/closed status plus check results and review details.",
  {
    repo: z.string().describe('Repository in owner/name format, e.g. "re-cinq/lore".'),
    pr_number: z.number().describe("Pull request number."),
  },
  async ({ repo, pr_number }) => {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) return { content: [{ type: "text" as const, text: "GITHUB_TOKEN not configured." }] };

      async function ghFetch(path: string): Promise<any> {
        const res = await fetch(`https://api.github.com${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
        return res.json();
      }

      const [pr, reviews] = await Promise.all([
        ghFetch(`/repos/${repo}/pulls/${pr_number}`),
        ghFetch(`/repos/${repo}/pulls/${pr_number}/reviews`).catch(() => []),
      ]);

      let checkRuns: any[] = [];
      try {
        const checksResp = await ghFetch(`/repos/${repo}/commits/${pr.head.sha}/check-runs`);
        checkRuns = checksResp.check_runs || [];
      } catch { /* no checks */ }

      const checks = checkRuns.map((c: any) => ({ name: c.name, status: c.status, conclusion: c.conclusion ?? null }));
      const reviewList = Array.isArray(reviews)
        ? reviews.map((r: any) => ({ user: r.user?.login || "unknown", state: r.state, submitted_at: r.submitted_at || "" }))
        : [];

      let computed_status: string;
      if (pr.merged) computed_status = "merged";
      else if (pr.state === "closed") computed_status = "closed";
      else if (pr.draft) computed_status = "draft";
      else if (checks.some((c: any) => c.conclusion === "failure" || c.conclusion === "timed_out")) computed_status = "checks-failing";
      else if (reviewList.some((r: any) => r.state === "CHANGES_REQUESTED")) computed_status = "changes-requested";
      else if (
        reviewList.some((r: any) => r.state === "APPROVED") &&
        checks.every((c: any) => c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === null)
      ) computed_status = "approved";
      else computed_status = "open";

      const result = {
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft ?? false,
        merged: pr.merged, mergeable: pr.mergeable ?? null, html_url: pr.html_url,
        checks, reviews: reviewList, computed_status,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_pipeline_tasks",
  "List pipeline tasks with optional filtering by status. Returns tasks ordered by creation time, newest first.",
  {
    status: z.string().optional().describe('Filter by status (e.g., "pending", "running", "pr-created", "failed"). Omit to return all tasks.'),
    limit: z.number().default(20).describe("Maximum number of tasks to return. Default 20, max 100."),
  },
  async ({ status, limit }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;
        if (!apiUrl || !apiToken) return { content: [{ type: "text" as const, text: "Pipeline requires LORE_API_URL + LORE_INGEST_TOKEN for remote access." }] };
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        params.set("limit", String(Math.min(limit, 100)));
        const res = await fetch(`${apiUrl}/api/tasks?${params}`, { headers: { "Authorization": `Bearer ${apiToken}` } });
        if (!res.ok) return { content: [{ type: "text" as const, text: `Remote error: ${res.statusText}` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
      }
      const validStatuses = ["pending", "queued", "running", "pr-created", "review", "merged", "failed", "cancelled"];
      if (status && !validStatuses.includes(status)) {
        return { content: [{ type: "text" as const, text: `invalid status: ${status}. Valid values: ${validStatuses.join(", ")}` }] };
      }
      const result = await listTasks(status, Math.min(limit, 100));
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "cancel_task",
  "Cancel a pipeline task. If the task has a running agent, attempts to cancel it.",
  {
    task_id: z.string().describe("UUID of the pipeline task to cancel."),
  },
  async ({ task_id }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await cancelTask(task_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error cancelling task: ${err.message}` }] };
    }
  }
);

server.tool(
  "mark_task_merged",
  "Manually mark a pipeline task as merged. Use this after a PR has been merged on GitHub.",
  {
    task_id: z.string().describe("UUID of the pipeline task whose PR was merged."),
  },
  async ({ task_id }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await markTaskMerged(task_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error marking task merged: ${err.message}` }] };
    }
  }
);

server.tool(
  "submit_review_result",
  "Submit a review result for a pipeline task. Approved tasks await human merge; rejected tasks get re-iterated (max 2 iterations) or escalated.",
  {
    task_id: z.string().describe("UUID of the pipeline task being reviewed."),
    approved: z.boolean().describe("Whether the review approves the changes."),
    comments: z.string().describe("Review comments. For rejections, explain what needs fixing."),
  },
  async ({ task_id, approved, comments }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      await handleReviewResult(task_id, approved, comments);
      return { content: [{ type: "text" as const, text: JSON.stringify({ task_id, approved, status: approved ? 'approved' : 'changes-requested' }) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error submitting review: ${err.message}` }] };
    }
  }
);

// --- Spec-task tools ---

server.tool(
  "sync_tasks",
  "Parse a tasks.md file and sync spec-tasks into the pipeline. Handles dependencies and parallelization markers.",
  {
    tasks_markdown: z.string().describe("Contents of tasks.md (the full markdown text)."),
    repo: z.string().optional().describe('Target repo in "owner/repo" format. Auto-detected if omitted.'),
    spec_slug: z.string().describe("Feature slug (e.g. 'auth-refactor'). Used to group tasks."),
  },
  async ({ tasks_markdown, repo, spec_slug }) => {
    try {
      const resolvedRepo = repo || detectCurrentRepo();
      if (!resolvedRepo) {
        return { content: [{ type: "text" as const, text: "Could not detect repo. Specify repo parameter." }] };
      }
      if (!dbPoolRef) {
        return { content: [{ type: "text" as const, text: "sync_tasks requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const parsed = parseTasks(tasks_markdown);
      if (parsed.length === 0) {
        return { content: [{ type: "text" as const, text: "No tasks found in the provided markdown." }] };
      }
      const result = await syncTasksToDb(dbPoolRef, resolvedRepo, spec_slug, parsed);
      const summary = `Synced ${result.synced} tasks (${result.created} new) for ${resolvedRepo} / ${spec_slug}.`;
      return { content: [{ type: "text" as const, text: summary }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error syncing tasks: ${err.message}` }] };
    }
  }
);

server.tool(
  "ready_tasks",
  "List spec-tasks that are ready to work on (all dependencies satisfied).",
  {
    repo: z.string().optional().describe('Target repo in "owner/repo" format. Auto-detected if omitted.'),
  },
  async ({ repo }) => {
    try {
      const resolvedRepo = repo || detectCurrentRepo();
      if (!resolvedRepo) {
        return { content: [{ type: "text" as const, text: "Could not detect repo. Specify repo parameter." }] };
      }
      if (!dbPoolRef) {
        return { content: [{ type: "text" as const, text: "ready_tasks requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const tasks = await getReadyTasks(dbPoolRef, resolvedRepo);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No ready tasks. All tasks are either completed, claimed, or blocked by dependencies." }] };
      }
      const lines = tasks.map((t: any) =>
        `- **${t.metadata?.spec_task_id}** (${t.id}): ${t.description}`
      );
      return { content: [{ type: "text" as const, text: `## Ready tasks\n\n${lines.join('\n')}` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error fetching ready tasks: ${err.message}` }] };
    }
  }
);

server.tool(
  "claim_task",
  "Atomically claim a spec-task so no other agent works on it.",
  {
    task_id: z.string().describe("UUID of the pipeline task to claim."),
    agent_id: z.string().optional().describe("Agent ID. Auto-resolved if omitted."),
  },
  async ({ task_id, agent_id }) => {
    try {
      if (!dbPoolRef) {
        return { content: [{ type: "text" as const, text: "claim_task requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const resolvedAgent = agent_id || resolveAgentId();
      const claimed = await claimTask(dbPoolRef, task_id, resolvedAgent);
      if (!claimed) {
        return { content: [{ type: "text" as const, text: `Could not claim task ${task_id}. It may already be claimed or does not exist.` }] };
      }
      return { content: [{ type: "text" as const, text: `Task ${task_id} claimed by ${resolvedAgent}.` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error claiming task: ${err.message}` }] };
    }
  }
);

server.tool(
  "complete_task",
  "Mark a spec-task as completed and report any newly unblocked tasks.",
  {
    task_id: z.string().describe("UUID of the pipeline task to complete."),
  },
  async ({ task_id }) => {
    try {
      if (!dbPoolRef) {
        return { content: [{ type: "text" as const, text: "complete_task requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await completeTask(dbPoolRef, task_id);
      if (!result.completed) {
        return { content: [{ type: "text" as const, text: `Could not complete task ${task_id}. It may not be in 'running' state.` }] };
      }
      let msg = `Task ${task_id} completed.`;
      if (result.unblocked.length > 0) {
        msg += `\n\nNewly unblocked tasks:\n${result.unblocked.map(u => `- ${u}`).join('\n')}`;
      }
      return { content: [{ type: "text" as const, text: msg }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error completing task: ${err.message}` }] };
    }
  }
);

server.tool(
  "get_analytics",
  "Returns org-level analytics: LLM costs, task throughput, success rates. Useful for cost tracking and usage reporting.",
  {
    period: z.enum(["today", "week", "month", "all"]).default("month").describe("Time period for analytics."),
  },
  async ({ period }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Analytics requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }

      const periodFilter = {
        today: "created_at > current_date",
        week: "created_at > date_trunc('week', current_date)",
        month: "created_at > date_trunc('month', current_date)",
        all: "TRUE",
      }[period];

      const [costResult, taskResult, byTypeResult] = await Promise.all([
        dbPoolRef.query(`SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as cost, count(*) as calls, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM pipeline.llm_calls WHERE ${periodFilter}`),
        dbPoolRef.query(`SELECT count(*) as total, count(*) FILTER (WHERE status IN ('pr-created', 'merged')) as succeeded, count(*) FILTER (WHERE status = 'failed') as failed FROM pipeline.tasks WHERE ${periodFilter}`),
        dbPoolRef.query(`SELECT t.task_type, count(DISTINCT t.id) as tasks, COALESCE(SUM(lc.cost_usd), 0)::numeric(10,2) as cost FROM pipeline.tasks t LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id WHERE t.${periodFilter} GROUP BY t.task_type ORDER BY cost DESC`),
      ]);

      const analytics = {
        period,
        cost: { total_usd: costResult.rows[0].cost, llm_calls: parseInt(costResult.rows[0].calls), input_tokens: parseInt(costResult.rows[0].input_tokens), output_tokens: parseInt(costResult.rows[0].output_tokens) },
        tasks: { total: parseInt(taskResult.rows[0].total), succeeded: parseInt(taskResult.rows[0].succeeded), failed: parseInt(taskResult.rows[0].failed) },
        by_type: byTypeResult.rows,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(analytics, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error fetching analytics: ${err.message}` }] };
    }
  }
);

// --- Repo onboarding tools ---

server.tool(
  "list_repos",
  "Returns all onboarded repos from lore.repos with pipeline task counts.",
  {},
  async () => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Repo management requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const repos = await getOnboardedReposWithCounts(dbPoolRef!);
      if (repos.length === 0) {
        return { content: [{ type: "text" as const, text: "No repos onboarded yet. Use onboard_repo to add one." }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(repos, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error listing repos: ${err.message}` }] };
    }
  }
);

server.tool(
  "onboard_repo",
  "Onboard a GitHub repo: creates branch with CLAUDE.md, AGENTS.md and PR template, opens a PR, and registers the repo in lore.repos.",
  {
    full_name: z.string().describe('Repository in "owner/repo" format (e.g., "re-cinq/lore").'),
  },
  async ({ full_name }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Repo onboarding requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const result = await onboardRepo(dbPoolRef!, full_name);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error onboarding repo: ${err.message}` }] };
    }
  }
);

// --- Ingest tool ---

server.tool(
  "ingest_files",
  "Manually ingest files from a repo into Lore's context store. Use this to make specific files searchable via search_context. The files are fetched from GitHub and embedded.",
  {
    files: z.array(z.string()).describe('File paths to ingest (e.g., ["CLAUDE.md", "adrs/ADR-001.md", "src/auth.ts"])'),
    repo: z.string().optional().describe('Repository in "owner/repo" format. Auto-detected from git remote if omitted.'),
  },
  async ({ files, repo }) => {
    try {
      const resolvedRepo = repo || detectCurrentRepo();
      if (!resolvedRepo) {
        return { content: [{ type: "text" as const, text: "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service')." }] };
      }

      // Proxy to GKE ingest API
      const apiUrl = process.env.LORE_API_URL;
      const apiToken = process.env.LORE_INGEST_TOKEN;
      if (!apiUrl || !apiToken) {
        return { content: [{ type: "text" as const, text: "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure." }] };
      }

      // Get the latest commit SHA for the repo
      let commit = "HEAD";
      try {
        const { execSync } = await import("node:child_process");
        commit = execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
      } catch {}

      const res = await fetch(`${apiUrl}/api/ingest`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files, repo: resolvedRepo, commit }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Ingestion failed: ${(err as any).error || res.statusText}` }] };
      }

      const result = await res.json() as any;
      return { content: [{ type: "text" as const, text: `Ingested ${result.ingested || 0} files into Lore for ${resolvedRepo}. ${result.errors || 0} errors.` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

// --- Local task runner tools (stdio-only, no-op on GKE) ---

server.tool(
  "run_task_locally",
  "Run a task in the background on your local machine using Claude Code in a git worktree. Returns immediately — your session continues normally while the task runs.",
  {
    description: z.string().describe("What to implement or do"),
    task_type: z.enum(["implementation", "general", "runbook", "gap-fill"]).default("implementation"),
    model: z.string().optional().describe("Model override (default: claude-sonnet-4-6)"),
  },
  async (args) => {
    try {
      const { spawnLocalTask, detectRepo, getRepoRoot } = await import("./local-runner.js");
      const repo = detectRepo();
      if (!repo) return { content: [{ type: "text" as const, text: "Error: not in a git repository with a GitHub remote" }] };

      // Create pipeline task via API
      const apiUrl = process.env.LORE_API_URL || "";
      const token = process.env.LORE_INGEST_TOKEN || "";
      let taskId = crypto.randomUUID();

      if (apiUrl && token) {
        try {
          const resp = await fetch(`${apiUrl}/api/task`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              description: args.description,
              task_type: args.task_type,
              target_repo: repo,
              created_by: "local-runner",
            }),
          });
          const data = await resp.json() as any;
          if (data.task_id) taskId = data.task_id;
        } catch { /* use generated UUID */ }
      }

      const task = spawnLocalTask({
        taskId,
        prompt: args.description,
        repo,
        taskType: args.task_type,
        model: args.model,
        repoRoot: getRepoRoot() || undefined,
      });

      return {
        content: [{
          type: "text" as const,
          text: `Task running locally in background.\n\nTask ID: ${task.taskId}\nBranch: ${task.branch}\nWorktree: ${task.worktreePath}\nLogs: ${task.logFile}\nPID: ${task.pid}\n\nYour session continues normally. Watch progress in the statusline.`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_local_tasks",
  "List all local background tasks (running, completed, failed).",
  {},
  async () => {
    try {
      const { listLocalTasks } = await import("./local-runner.js");
      const tasks = listLocalTasks();
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No local tasks." }] };
      }
      const lines = tasks.map((t: any) =>
        `${t.taskId.substring(0, 8)} ${t.status} ${t.repo} ${t.branch}${t.prUrl ? " → " + t.prUrl : ""}${t.error ? " ✗ " + t.error : ""}`
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "cancel_local_task",
  "Cancel a running local background task and clean up its worktree.",
  {
    task_id: z.string().describe("Task ID to cancel"),
  },
  async (args) => {
    try {
      const { cancelLocalTask } = await import("./local-runner.js");
      const result = cancelLocalTask(args.task_id);
      return {
        content: [{
          type: "text" as const,
          text: result.cancelled
            ? `Task ${args.task_id} cancelled. Worktree cleaned up.`
            : `Could not cancel: ${result.error}`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

// --- Task notification + interactive claim tools (Phase 2) ---

server.tool(
  "enable_task_notifications",
  "Start watching for pending pipeline tasks on repos you work with. Shows new tasks in the statusline so you can decide to run them locally or let GKE handle them.",
  {
    repos: z.array(z.string()).optional().describe("Repos to watch (e.g. ['re-cinq/lore']). Defaults to current repo."),
    task_types: z.array(z.string()).optional().describe("Task types to watch. Defaults to implementation, general, runbook, gap-fill."),
  },
  async (args) => {
    try {
      const { startNotifier, detectRepo, isNotifierRunning } = await import("./local-runner.js");
      if (isNotifierRunning()) {
        return { content: [{ type: "text" as const, text: "Task notifications already active." }] };
      }
      const repos = args.repos || [detectRepo()].filter(Boolean) as string[];
      if (repos.length === 0) {
        return { content: [{ type: "text" as const, text: "Error: no repos to watch. Pass repos explicitly or run from a git repo with a GitHub remote." }] };
      }
      const taskTypes = args.task_types || ["implementation", "general", "runbook", "gap-fill"];
      startNotifier(repos, taskTypes);
      return {
        content: [{
          type: "text" as const,
          text: `Watching for pending tasks on ${repos.join(", ")}.\nTypes: ${taskTypes.join(", ")}\nCheck the statusline for new tasks.`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "disable_task_notifications",
  "Stop watching for pending pipeline tasks.",
  {},
  async () => {
    try {
      const { stopNotifier } = await import("./local-runner.js");
      stopNotifier();
      return { content: [{ type: "text" as const, text: "Task notifications stopped." }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_pending_tasks",
  "Show pending pipeline tasks that can be claimed and run locally.",
  {},
  async () => {
    try {
      const { listPendingTasks } = await import("./local-runner.js");
      const tasks = listPendingTasks();
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No pending tasks." }] };
      }
      const lines = tasks.map((t: any) =>
        `${t.id.substring(0, 8)} ${t.task_type} ${t.target_repo}${t.issue_number ? " #" + t.issue_number : ""}\n  ${t.description}`
      );
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "claim_and_run_locally",
  "Claim a pending pipeline task and run it locally in the background. The task runs in a git worktree using your Claude Code subscription (zero API cost).",
  {
    task_id: z.string().describe("Task ID to claim (from list_pending_tasks)"),
    model: z.string().optional().describe("Model override"),
  },
  async (args) => {
    try {
      const { spawnLocalTask, getRepoRoot, skipTask, listPendingTasks } = await import("./local-runner.js");

      // Find the task in pending list
      const pending = listPendingTasks();
      const task = pending.find((t: any) => t.id === args.task_id || t.id.startsWith(args.task_id));
      if (!task) {
        return { content: [{ type: "text" as const, text: `Task ${args.task_id} not found in pending tasks. Run list_pending_tasks first.` }] };
      }

      // Claim via API (best effort)
      const apiUrl = process.env.LORE_API_URL || "";
      const token = process.env.LORE_INGEST_TOKEN || "";
      if (apiUrl && token) {
        try {
          await fetch(`${apiUrl}/api/task`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: task.id, action: "claim", claimed_by: "local-runner" }),
          });
        } catch { /* best effort */ }
      }

      // Spawn locally
      const localTask = spawnLocalTask({
        taskId: task.id,
        prompt: task.description,
        repo: task.target_repo,
        taskType: task.task_type,
        model: args.model,
        repoRoot: getRepoRoot() || undefined,
      });

      // Remove from pending
      skipTask(task.id);

      return {
        content: [{
          type: "text" as const,
          text: `Claimed and running locally.\n\nTask: ${task.id}\nBranch: ${localTask.branch}\nLogs: ${localTask.logFile}\nPID: ${localTask.pid}`,
        }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "skip_task",
  "Dismiss a pending task notification. GKE will pick it up instead.",
  {
    task_id: z.string().describe("Task ID to skip"),
  },
  async (args) => {
    try {
      const { skipTask } = await import("./local-runner.js");
      skipTask(args.task_id);
      return { content: [{ type: "text" as const, text: `Task ${args.task_id} skipped. GKE will handle it.` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.tool(
  "configure_local_runner",
  "View or update local task runner settings. Controls which repos and task types the runner watches, concurrency limits, and default model.",
  {
    max_concurrent: z.number().optional().describe("Max concurrent local tasks (default: 2)"),
    repos: z.array(z.string()).optional().describe("Repos to watch (e.g. ['re-cinq/lore'])"),
    task_types: z.array(z.string()).optional().describe("Task types to run locally"),
    model: z.string().optional().describe("Default model for local tasks"),
  },
  async (args) => {
    try {
      const { readConfig, writeConfig } = await import("./local-runner.js");
      const config = readConfig();

      // If no args provided, return current config
      if (!args.max_concurrent && !args.repos && !args.task_types && !args.model) {
        return { content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }] };
      }

      // Update provided fields
      if (args.max_concurrent !== undefined) config.max_concurrent = args.max_concurrent;
      if (args.repos) config.repos = args.repos;
      if (args.task_types) config.task_types = args.task_types;
      if (args.model) config.model = args.model;

      writeConfig(config);
      return { content: [{ type: "text" as const, text: `Config updated:\n${JSON.stringify(config, null, 2)}` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

// --- GitHub webhook helpers ---

async function getGitHubToken(): Promise<string | null> {
  // Prefer App auth (same as agent), fall back to GITHUB_TOKEN
  const appId = process.env.GITHUB_APP_ID;
  const pk = process.env.GITHUB_APP_PRIVATE_KEY;
  const instId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (appId && pk && instId) {
    try {
      const { createAppAuth } = await import("@octokit/auth-app");
      const auth = createAppAuth({ appId, privateKey: pk, installationId: instId });
      const { token } = await auth({ type: "installation" });
      return token;
    } catch { /* fall through */ }
  }
  return process.env.GITHUB_TOKEN || null;
}

async function ghIssueComment(repo: string, issueNumber: number, body: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json" },
    body: JSON.stringify({ body }),
  });
}

async function ghAddLabel(repo: string, issueNumber: number, label: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json" },
    body: JSON.stringify({ labels: [label] }),
  });
}

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
    setMemoryPool(dbPool);
    setPipelinePool(dbPool);
    dbPoolRef = dbPool;
    console.error(`[lore] Database mode: PostgreSQL at ${dbHost}`);
  } else {
    console.error("[lore] Database mode: local files (LORE_DB_HOST not set)");
  }

  // Initialize pipeline config and context assembly templates
  loadTaskTypes();
  loadTemplates();
  if (process.env.LORE_DB_HOST) {
    console.error('[lore] Pipeline task CRUD ready (processing handled by lore-agent)');
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
        // Add task and cost stats if DB is available
        let tasks = { processed_today: 0, pending: 0 };
        let todayCost = "0.00";
        if (health.connected && dbPoolRef) {
          try {
            const [taskStats, costStats] = await Promise.all([
              dbPoolRef.query(`SELECT count(*) FILTER (WHERE created_at > current_date)::int as today, count(*) FILTER (WHERE status = 'pending')::int as pending FROM pipeline.tasks`),
              dbPoolRef.query(`SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as cost FROM pipeline.llm_calls WHERE created_at > current_date`),
            ]);
            tasks = { processed_today: taskStats.rows[0]?.today || 0, pending: taskStats.rows[0]?.pending || 0 };
            todayCost = costStats.rows[0]?.cost || "0.00";
          } catch { /* non-fatal */ }
        }
        res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify({ status, database: health, tasks, today_cost: todayCost }));
      } else if (req.url?.startsWith("/api/repo-status") && req.method === "GET") {
        // Statusline cache endpoint — returns onboarded, tasks, memories, auto_review
        const url = new URL(req.url, `http://${req.headers.host}`);
        const repo = url.searchParams.get("repo");
        console.log(`[repo-status] repo=${repo} dbPoolRef=${!!dbPoolRef}`);
        if (!repo || !dbPoolRef) {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ onboarded: false }));
          return;
        }
        try {
          const repoRow = await dbPoolRef.query(`SELECT settings FROM lore.repos WHERE full_name = $1`, [repo]);
          if (repoRow.rows.length === 0) {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ onboarded: false, repo }));
            return;
          }
          const settings = repoRow.rows[0].settings || {};
          const running = await dbPoolRef.query(
            `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status = 'running'`, [repo],
          );
          const prReady = await dbPoolRef.query(
            `SELECT count(*) as c FROM pipeline.tasks WHERE target_repo = $1 AND status IN ('pr-created', 'review')`, [repo],
          );
          const memories = await dbPoolRef.query(`SELECT count(*) as c FROM memory.memories WHERE is_deleted = false`);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
            onboarded: true,
            repo,
            running: Number(running.rows[0]?.c || 0),
            pr_ready: Number(prReady.rows[0]?.c || 0),
            memories: Number(memories.rows[0]?.c || 0),
            auto_review: settings.auto_review === true,
          }));
        } catch (err: any) {
          console.error("[repo-status] Error:", err.message);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ onboarded: false, error: err.message }));
        }
      } else if (req.url === "/api/ingest" && req.method === "POST") {
        // Bearer token auth
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        if (!dbPoolRef) {
          res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "database not available" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const { files, repo, commit } = JSON.parse(body);
            if (!Array.isArray(files) || !repo || !commit) {
              res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "required: files (array), repo (string), commit (string)" }));
              return;
            }
            const result = await ingestFiles(dbPoolRef, files, repo, commit);
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          } catch (err: any) {
            console.error("[ingest] API error:", err.message);
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
          }
        });
      } else if (req.url === "/api/onboard" && req.method === "POST") {
        // Bearer token auth
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        if (!dbPoolRef) {
          res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "database not available" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const { repo } = JSON.parse(body);
            if (!repo || !repo.includes("/")) {
              res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "required: repo (owner/name format)" }));
              return;
            }
            const result = await onboardRepo(dbPoolRef, repo);
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          } catch (err: any) {
            console.error("[onboard] API error:", err.message);
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
          }
        });
      } else if (req.url?.startsWith("/api/context") && req.method === "GET") {
        // Get repo context from the vector store
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
        const url = new URL(req.url, "http://localhost");
        const repo = url.searchParams.get("repo");
        try {
          const parts: string[] = [];
          // Repo-specific docs only
          if (repo && dbPoolRef) {
            const { rows } = await dbPoolRef.query(
              `SELECT content, content_type, file_path FROM org_shared.chunks
               WHERE repo = $1 AND content_type IN ('doc', 'adr', 'spec')
               ORDER BY content_type, ingested_at DESC`,
              [repo],
            );
            for (const r of rows) parts.push(r.content);
          }
          if (parts.length > 0) {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text: parts.join("\n\n---\n\n") }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text: null }));
          }
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
        }
      } else if (req.url?.startsWith("/api/task/") && req.method === "GET") {
        // Get single task by ID
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
        const taskId = req.url.replace("/api/task/", "");
        try {
          const task = await getTask(taskId);
          if (!task) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" })); return; }
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(task));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
        }
      } else if (req.url?.startsWith("/api/tasks") && req.method === "GET") {
        // List tasks with optional status filter
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
        const url = new URL(req.url, `http://localhost`);
        const status = url.searchParams.get("status") || undefined;
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
        try {
          const result = await listTasks(status, limit);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
        }
      } else if (req.url === "/api/task" && req.method === "POST") {
        // Create pipeline task via REST
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        if (!dbPoolRef) {
          res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "database not available" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body);

            // Cancel action
            if (parsed.action === "cancel" && parsed.task_id) {
              await dbPoolRef.query(
                `UPDATE pipeline.tasks SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled', 'merged')`,
                [parsed.task_id],
              );
              res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, task_id: parsed.task_id }));
              return;
            }

            // Create action (default)
            const { description, task_type, target_repo, context } = parsed;
            if (!description?.trim()) {
              res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "description is required" }));
              return;
            }
            const validTypes = getTaskTypes();
            const resolvedType = validTypes.includes(task_type || "") ? task_type : "general";
            const result = await createTask(description, resolvedType, target_repo, "remote-mcp", context || undefined);
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          } catch (err: any) {
            console.error("[api/task] error:", err.message);
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
          }
        });
      } else if (req.url === "/api/memory" && req.method === "POST") {
        // Memory API — write, read, search, delete memories via REST
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const { action, key, value, agent_id, ttl, query: searchQuery, limit, version, pool_name, repo } = JSON.parse(body);
            let result: any;
            const embedding = (action === "write" || action === "search") && (value || searchQuery) ? await getQueryEmbedding(value || searchQuery || "") : null;

            switch (action) {
              case "write":
                if (!key || !value) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "key and value required" })); return; }
                result = isMemoryDbAvailable()
                  ? await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo)
                  : await writeMemoryFile(key, value, agent_id, ttl);
                break;
              case "read":
                if (!key) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "key required" })); return; }
                const ver = version === "all" ? "all" : version ? Number(version) : undefined;
                result = isMemoryDbAvailable()
                  ? await readMemory(key, agent_id, ver)
                  : await readMemoryFile(key, agent_id, ver);
                break;
              case "search":
                if (!searchQuery) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "query required" })); return; }
                result = isMemoryDbAvailable()
                  ? await searchMemories(dbPoolRef, searchQuery, agent_id, pool_name, limit || 10)
                  : await searchMemoryFile(searchQuery, agent_id, limit || 10);
                break;
              case "delete":
                if (!key) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "key required" })); return; }
                result = isMemoryDbAvailable()
                  ? await deleteMemory(key, agent_id)
                  : await deleteMemoryFile(key, agent_id);
                break;
              case "list":
                result = isMemoryDbAvailable()
                  ? await listMemories(agent_id, limit || 50, 0)
                  : await listMemoriesFile(agent_id, limit || 50, 0);
                break;
              default:
                res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "action must be: write, read, search, delete, list" }));
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
          }
        });
      } else if (req.url === "/api/episode" && req.method === "POST") {
        // Write episode via REST — used by session summary hook
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (token && auth !== `Bearer ${token}`) { res.writeHead(401).end("Unauthorized"); return; }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const { content, source, ref, agent_id } = JSON.parse(body);
            if (!content) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "content required" })); return; }
            const agent = agent_id || 'unknown';
            const contentHash = createHash("sha256").update(content).digest("hex");
            const { rows } = await dbPoolRef.query(
              `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (agent_id, content_hash) DO NOTHING
               RETURNING id`,
              [agent, content, contentHash, source || 'session', ref || null],
            );
            if (rows.length === 0) {
              res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "duplicate" }));
              return;
            }
            // Trigger async fact extraction
            extractFactsFromEpisode(rows[0].id, content, agent, dbPoolRef).catch(() => {});
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", episode_id: rows[0].id }));
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
          }
        });
      } else if (req.url === "/api/webhook/github" && req.method === "POST") {
        // GitHub webhook — issues.labeled event dispatch
        const webhookSecret = process.env.LORE_WEBHOOK_SECRET;
        const signature = req.headers["x-hub-signature-256"] as string | undefined;
        const ghEvent = req.headers["x-github-event"] as string | undefined;

        let rawBody = "";
        req.on("data", (chunk: Buffer) => { rawBody += chunk.toString(); });
        req.on("end", async () => {
          // Validate HMAC SHA-256 signature
          if (webhookSecret) {
            if (!signature) {
              res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "missing signature" }));
              return;
            }
            const { createHmac, timingSafeEqual } = await import("node:crypto");
            const expected = "sha256=" + createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
            const sigBuf = Buffer.from(signature);
            const expBuf = Buffer.from(expected);
            if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
              res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid signature" }));
              return;
            }
          }

          if (ghEvent !== "issues") {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ skipped: true, reason: "not an issues event" }));
            return;
          }

          let payload: any;
          try {
            payload = JSON.parse(rawBody);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid JSON" }));
            return;
          }

          if (payload.action !== "labeled") {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ skipped: true, reason: "not a labeled action" }));
            return;
          }

          const repoFullName: string = payload.repository?.full_name;
          const issue = payload.issue;
          const addedLabel: string = payload.label?.name;

          if (!repoFullName || !issue || !addedLabel) {
            res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "missing required fields" }));
            return;
          }

          // Fetch per-repo settings from lore.repos
          let dispatchLabel = "lore";
          let dispatchDefaultType = "general";
          if (dbPoolRef) {
            try {
              const { rows } = await dbPoolRef.query(
                `SELECT settings FROM lore.repos WHERE full_name = $1`,
                [repoFullName],
              );
              if (rows.length > 0 && rows[0].settings) {
                const settings = typeof rows[0].settings === "string" ? JSON.parse(rows[0].settings) : rows[0].settings;
                if (settings.dispatch_label) dispatchLabel = settings.dispatch_label;
                if (settings.dispatch_default_type) dispatchDefaultType = settings.dispatch_default_type;
              }
            } catch { /* use defaults */ }
          }

          if (addedLabel !== dispatchLabel) {
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ skipped: true, reason: "label does not match dispatch_label" }));
            return;
          }

          if (!dbPoolRef) {
            res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "database not available" }));
            return;
          }

          const issueNumber: number = issue.number;
          const issueTitle: string = issue.title || "";
          const issueBody: string = issue.body || "";
          const issueUrl: string = issue.html_url || "";
          const issueLabels: string[] = (issue.labels || []).map((l: any) => l.name as string);

          // Determine task type from labels
          let taskType = dispatchDefaultType;
          if (issueLabels.includes("lore:implementation")) taskType = "implementation";
          else if (issueLabels.includes("lore:review")) taskType = "review";
          else if (issueLabels.includes("lore:runbook")) taskType = "runbook";

          // Duplicate prevention
          try {
            const { rows: existing } = await dbPoolRef.query(
              `SELECT id FROM pipeline.tasks
               WHERE issue_number = $1 AND target_repo = $2
                 AND status NOT IN ('failed', 'cancelled')`,
              [issueNumber, repoFullName],
            );
            if (existing.length > 0) {
              const existingId = existing[0].id;
              await ghIssueComment(repoFullName, issueNumber, `Already being worked on: task \`${existingId}\``);
              res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ skipped: true, reason: "duplicate", task_id: existingId }));
              return;
            }
          } catch (err: any) {
            console.error("[webhook] duplicate check error:", err.message);
          }

          // Create pipeline task
          const description = `${issueTitle}\n\n${issueBody}`.trim();
          const contextBundle = {
            github_issue_number: issueNumber,
            github_issue_url: issueUrl,
            github_issue_body: issueBody,
          };

          let taskResult: any;
          try {
            taskResult = await createTask(description, taskType, repoFullName, "github-webhook", contextBundle);
            // Persist issue_number and issue_url on the task row
            await dbPoolRef.query(
              `UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`,
              [issueNumber, issueUrl, taskResult.task_id],
            );
          } catch (err: any) {
            console.error("[webhook] createTask error:", err.message);
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
            return;
          }

          // Comment on the issue and add lore-managed label (best-effort)
          await Promise.allSettled([
            ghIssueComment(repoFullName, issueNumber, `Lore agent is working on this. Task: \`${taskResult.task_id}\``),
            ghAddLabel(repoFullName, issueNumber, "lore-managed"),
          ]);

          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ task_id: taskResult.task_id, status: taskResult.status }));
        });
      } else if (req.url === "/api/task-logs" && req.method === "POST") {
        // Receive logs from local runner and write to GCS
        const token = process.env.LORE_INGEST_TOKEN;
        const auth = req.headers.authorization;
        if (!token || auth !== `Bearer ${token}`) {
          res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", async () => {
          try {
            const { task_id, repo, logs } = JSON.parse(body);
            if (!task_id || !repo || !logs) {
              res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "missing fields" }));
              return;
            }
            const { Storage } = await import("@google-cloud/storage");
            const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
            await bucket.file(`${repo}/${task_id}/output.log`).save(logs, { resumable: false, contentType: "text/plain" });
            res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
          }
        });
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
