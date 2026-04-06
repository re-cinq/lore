import { initOtel, traceRetrieval } from "./otel.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";
import pg from "pg";
import {
  hybridSearch,
  isDbAvailable,
  setPool,
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
import { extractFacts, extractFactsFromEpisode, setFactsCostPool } from "./facts.js";
import { extractAndUpdateGraph, queryLiveGraph } from "./graph.js";
import { assembleContext, loadTemplates } from "./context-assembly.js";
import { trackToolCall, dumpSessionLog } from "./session-tracker.js";
import { handleApiRoute } from "./routes.js";

// Secret redaction from shared package
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { createHash } from "node:crypto";
import {
  createTask,
  getTask,
  listTasks,
  cancelTask,
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
  onboardRepo,
} from './repo-onboard.js';
import { detectCurrentRepo } from './repo-detect.js';

const CONTEXT_PATH = process.env.CONTEXT_PATH || process.cwd();

// Module-level pool ref for tools that take pool as argument
let dbPoolRef: any = null;

function readFileSafe(path: string): string | null {
  try { return readFileSync(path, "utf-8"); } catch { return null; }
}

const server = new McpServer({ name: "@re-cinq/lore-mcp", version: "0.1.0" });

// --- Latency tracking helper ---
async function trackLatency(tool: string, fn: () => Promise<any>): Promise<any> {
  const start = Date.now();
  let success = true;
  try {
    const result = await fn();
    return result;
  } catch (err) {
    success = false;
    throw err;
  } finally {
    const latencyMs = Date.now() - start;
    trackToolCall(tool, latencyMs, success);
    if (dbPoolRef) {
      dbPoolRef.query(
        `INSERT INTO memory.audit_log (agent_id, operation, metadata) VALUES ($1, $2, $3)`,
        ['system', tool, JSON.stringify({ latency_ms: latencyMs })],
      ).catch(() => {});
    }
  }
}

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

// --- Memory proxy helper (for local mode without DB) ---

// --- API proxy helper (for local mode without DB) ---

async function proxyToApi(endpoint: string, body: Record<string, any>): Promise<string | null> {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;
  if (!apiUrl || !apiToken) return null;
  try {
    const res = await fetch(`${apiUrl}${endpoint}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return JSON.stringify(await res.json());
  } catch { return null; }
}

function proxyMemory(action: string, params: Record<string, any>): Promise<string | null> {
  return proxyToApi("/api/memory", { action, ...params });
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
        // Proxy to GKE
        const proxied = await proxyToApi("/api/episode", {
          content, source, ref, agent_id: agent_id || resolveAgentId(),
        });
        if (proxied) return { content: [{ type: "text" as const, text: proxied }] };
        return { content: [{ type: "text" as const, text: "Episodes require PostgreSQL or LORE_API_URL. Neither is configured." }] };
      }
      const agent = resolveAgentId(agent_id);
      // Privacy filter: strip secrets before storing in org-wide memory
      const safeContent = sanitizeContent(content);
      const contentHash = createHash("sha256").update(safeContent).digest("hex");
      const embedding = await getQueryEmbedding(safeContent);
      const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

      const { rows } = await dbPoolRef.query(
        `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_id, content_hash) DO NOTHING
         RETURNING id`,
        [agent, safeContent, contentHash, source, ref || null, embeddingStr],
      );

      if (rows.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ status: "duplicate", message: "Episode already ingested." }) }] };
      }

      const episodeId = rows[0].id;

      // Trigger async fact extraction and graph update (don't block the response)
      extractFactsFromEpisode(episodeId, content, agent, dbPoolRef).catch((err) =>
        console.warn(`[episode] Fact extraction failed for ${episodeId}: ${err.message}`),
      );

      // Graph extraction (async, best-effort)
      {
        const graphModel = process.env.LORE_FACT_MODEL || 'claude-haiku-4-5-20251001';
        const graphLlmCall = async (prompt: string) => {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            // Fall back to Claude CLI (uses subscription, no API credits)
            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const execFileAsync = promisify(execFile);
            const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
              timeout: 30_000,
              env: { ...process.env },
            });
            return stdout.trim();
          }
          const start = Date.now();
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: graphModel,
              max_tokens: 1024,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
          const json = await res.json() as any;
          const durationMs = Date.now() - start;
          // Track cost
          if (json.usage && dbPoolRef) {
            const inputCost = 0.8 / 1_000_000;
            const outputCost = 4.0 / 1_000_000;
            const costUsd = json.usage.input_tokens * inputCost + json.usage.output_tokens * outputCost;
            dbPoolRef.query(
              `INSERT INTO pipeline.llm_calls (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
               VALUES (NULL, 'graph-extraction', $1, $2, $3, $4, $5)`,
              [graphModel, json.usage.input_tokens, json.usage.output_tokens, costUsd, durationMs],
            ).catch(() => {});
          }
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

// --- Agent stats tool (merged: health + stats + recent episodes) ---

server.tool(
  "agent_stats",
  "Returns comprehensive agent statistics: memory count, last activity, snapshot count, total memories, active/invalidated facts, searches, shared pools, and recent episodes.",
  {
    agent_id: z.string().optional().describe("Override agent ID."),
  },
  async ({ agent_id }) => {
    try {
      if (!isMemoryDbAvailable()) {
        return { content: [{ type: "text" as const, text: "Agent stats requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const agent = resolveAgentId(agent_id);

      // Fetch health, stats, and recent episodes in parallel
      const [healthResult, statsResult, episodesResult] = await Promise.all([
        agentHealth(agent_id),
        agentStats(agent_id),
        dbPoolRef.query(
          `SELECT e.id, e.source, e.ref, e.created_at,
                  LEFT(e.content, 200) as content_preview,
                  (SELECT count(*)::int FROM memory.facts f WHERE f.episode_id = e.id) as fact_count
           FROM memory.episodes e
           WHERE e.agent_id = $1
           ORDER BY e.created_at DESC
           LIMIT 5`,
          [agent],
        ).catch(() => ({ rows: [] })),
      ]);

      // Get total episode count
      let episodeCount = 0;
      try {
        const { rows } = await dbPoolRef.query(
          `SELECT count(*)::int as total FROM memory.episodes WHERE agent_id = $1`,
          [agent],
        );
        episodeCount = rows[0]?.total || 0;
      } catch {}

      const result = {
        ...healthResult,
        ...statsResult,
        recent_episodes: {
          total_count: episodeCount,
          latest: episodesResult.rows,
        },
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error fetching agent stats: ${err.message}` }] };
    }
  }
);

// --- Pipeline tools ---

server.tool(
  "create_pipeline_task",
  "Create a pipeline task. By default tasks go to the backlog (priority=normal) for developers to pick up locally. Set priority=immediate to have the GKE agent auto-execute it. Available types: feature-request (PM intent → spec + tasks), onboard (add repo to Lore), general (open-ended), runbook (write ops runbook), implementation (code from spec), gap-fill (draft missing docs), review (review a PR).",
  {
    description: z.string().describe("What should the agent do? Be specific — this is the primary instruction. For feature-request: describe the feature in plain language. For onboard: just the repo name."),
    task_type: z.string().default("general").describe('Task type: "feature-request", "onboard", "general", "runbook", "implementation", "gap-fill", "review".'),
    target_repo: z.string().optional().describe('Target GitHub repository in "owner/repo" format. Auto-detected from git remote if omitted.'),
    priority: z.enum(["normal", "immediate"]).default("normal").describe('Task priority. "normal" = backlog (developers pick up locally). "immediate" = GKE agent auto-executes.'),
    context: z.object({
      spec_file: z.boolean().optional(),
      branch: z.string().optional(),
      seed_query: z.string().optional(),
    }).optional().describe("Additional context to pass to the agent."),
  },
  async ({ description: desc, task_type, target_repo, priority, context }) => {
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
          body: JSON.stringify({ description: desc, task_type, target_repo: resolvedRepo, priority, context }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Remote task creation failed: ${(err as any).error || res.statusText}` }] };
        }
        const result = await res.json() as any;
        const pickupMsg = priority === "immediate"
          ? "The GKE agent will pick this up within 30 seconds."
          : "Task added to backlog. Claim it locally with claim_and_run_locally, or set priority to immediate via the UI.";
        const msg = `Task created: ${result.task_id}\nType: ${task_type}\nPriority: ${priority}\nRepo: ${resolvedRepo || 'default'}\n\n${pickupMsg}`;
        return { content: [{ type: "text" as const, text: msg }] };
      }

      const validTypes = getTaskTypes();
      const resolvedType = validTypes.includes(task_type) ? task_type : "general";
      const result = await createTask(desc, resolvedType, resolvedRepo, "mcp", context || undefined, priority);
      const pickupMsg = priority === "immediate"
        ? "The GKE agent will pick this up within 30 seconds."
        : "Task added to backlog. Claim it locally with claim_and_run_locally, or set priority to immediate via the UI.";
      const msg = `Task created: ${result.task_id}\nType: ${resolvedType}\nPriority: ${priority}\nRepo: ${resolvedRepo || 'default'}\n\n${pickupMsg}`;
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
      const { getGitHubToken } = await import("./github-client.js");
      const token = await getGitHubToken();
      if (!token) return { content: [{ type: "text" as const, text: "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN." }] };

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
  "retry_task",
  "Retry a failed pipeline task. Creates a new task with the same parameters and links it to the original.",
  {
    task_id: z.string().describe("UUID of the failed task to retry."),
  },
  async ({ task_id }) => {
    try {
      if (!process.env.LORE_DB_HOST) {
        return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const { retryTask } = await import('./pipeline.js');
      const result = await retryTask(task_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error retrying task: ${err.message}` }] };
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

      // Get the latest commit SHA — only use local HEAD if repo matches
      let commit = "HEAD";
      try {
        const { execSync } = await import("node:child_process");
        const localRepo = detectCurrentRepo();
        if (localRepo === resolvedRepo) {
          commit = execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
        }
        // For other repos, "HEAD" tells GitHub to use the default branch
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

      const task = await spawnLocalTask({
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
      const localTask = await spawnLocalTask({
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
    setFactsCostPool(dbPool);
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
    const MAX_BODY_BYTES = 1_048_576; // 1MB

    const httpServer = createServer(async (req, res) => {
      // Enforce body size limit on all POST requests
      if (req.method === "POST") {
        const contentLength = parseInt(req.headers["content-length"] || "0", 10);
        if (contentLength > MAX_BODY_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "request body too large" }));
          return;
        }
      }

      if (req.url === "/mcp" || req.url === "/mcp/") {
        await transport.handleRequest(req, res);
      } else {
        const handled = await handleApiRoute(req, res, dbPoolRef);
        if (!handled) res.writeHead(404).end();
      }
    });
    await server.connect(transport);
    httpServer.listen(port, () => {
      console.log(`MCP server (HTTP) listening on :${port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Dump session log on exit (for Stop hook to POST as episode)
    const exitHandler = () => dumpSessionLog();
    process.on("SIGTERM", exitHandler);
    process.on("SIGINT", exitHandler);
    process.on("beforeExit", exitHandler);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
