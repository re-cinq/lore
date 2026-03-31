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
import { extractFacts } from "./facts.js";
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

// --- get_context ---
server.tool(
  "get_context",
  "Returns merged CLAUDE.md content for the org and optionally a specific team.",
  { team: z.string().optional().describe('Team name (e.g., "payments"). If omitted, returns org-level context only.') },
  async ({ team }) => {
    // Auto-detect repo from git remote when no team is specified.
    // The MCP server runs locally via stdio, so cwd is the developer's repo.
    const detectedRepo = !team ? detectCurrentRepo() : null;
    if (detectedRepo) {
      console.error(`[lore] Auto-detected repo: ${detectedRepo}`);
    }

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
    // Auto-detect repo from git remote when no team is specified.
    // Scopes DB search to the detected repo's context namespace.
    const detectedRepo = !team ? detectCurrentRepo() : null;
    if (detectedRepo) {
      console.error(`[lore] search_context: auto-detected repo ${detectedRepo}`);
    }

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

// --- Memory tools ---

server.tool(
  "write_memory",
  "Store a new memory or update an existing one. Returns version number.",
  {
    key: z.string().describe("Memory key (e.g. 'user-preference', 'last-gap-run')"),
    value: z.string().describe("Memory value (text)"),
    agent_id: z.string().optional().describe("Override agent ID. Defaults to ~/.lore/agent-id."),
    ttl: z.number().optional().describe("Time-to-live in seconds. Omit for permanent."),
    extract_facts: z.boolean().optional().describe("Extract individual facts from value (async)."),
  },
  async ({ key, value, agent_id, ttl, extract_facts }) => {
    try {
      const embedding = await getQueryEmbedding(value);
      if (isMemoryDbAvailable()) {
        const result = await writeMemory(key, value, agent_id, ttl, embedding || undefined);
        if (extract_facts) {
          // Async fact extraction — fire and forget
          import("./memory.js").then(({ getMemoryPool }) => {
            const p = getMemoryPool();
            if (p) {
              p.query(
                `SELECT id FROM memory.memories WHERE agent_id = $1 AND key = $2 ORDER BY version DESC LIMIT 1`,
                [resolveAgentId(agent_id), key]
              ).then((r: any) => {
                if (r.rows[0]?.id) extractFacts(r.rows[0].id, value, p).catch(() => {});
              });
            }
          });
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
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
      const result = isMemoryDbAvailable()
        ? await readMemory(key, agent_id, ver)
        : await readMemoryFile(key, agent_id, ver);
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
      const result = isMemoryDbAvailable()
        ? await deleteMemory(key, agent_id)
        : await deleteMemoryFile(key, agent_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error deleting memory: ${err.message}` }] };
    }
  }
);

server.tool(
  "list_memories",
  "List all memories for an agent, paginated.",
  {
    agent_id: z.string().optional(),
    limit: z.number().default(50).describe("Max results."),
    offset: z.number().default(0).describe("Pagination offset."),
  },
  async ({ agent_id, limit, offset }) => {
    try {
      const result = isMemoryDbAvailable()
        ? await listMemories(agent_id, limit, offset)
        : await listMemoriesFile(agent_id, limit, offset);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error listing memories: ${err.message}` }] };
    }
  }
);

server.tool(
  "search_memory",
  "Semantic search across agent memories. Returns results ranked by similarity.",
  {
    query: z.string().describe("Natural language search query."),
    agent_id: z.string().optional().describe("Scope to agent. Omit for cross-agent search."),
    pool: z.string().optional().describe("Search within a shared pool."),
    limit: z.number().default(10),
  },
  async ({ query, agent_id, pool, limit }) => {
    try {
      if (isMemoryDbAvailable()) {
        const results = await searchMemories(
          null, // pool is passed via the memory module's internal pool
          query, agent_id, pool, limit
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      }
      const results = await searchMemoryFile(query, agent_id, limit);
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error searching memories: ${err.message}` }] };
    }
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
  "Create a new task in the pipeline. The task enters 'pending' status and will be picked up by the poller.",
  {
    description: z.string().describe("Task description. What should the agent do? Be specific -- this is the primary instruction the agent receives."),
    task_type: z.string().default("general").describe('Task type from task-types.yaml (e.g., "general", "runbook", "implementation", "gap-fill"). Determines prompt template, timeout, and review policy.'),
    target_repo: z.string().optional().describe('Target GitHub repository in "owner/repo" format (e.g., "re-cinq/lore"). If omitted, uses the default from task type config.'),
    context: z.object({
      beads_task_id: z.string().optional(),
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

      // When running locally (no DB), proxy to the GKE MCP server
      if (!process.env.LORE_DB_HOST) {
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;
        if (!apiUrl || !apiToken) {
          return { content: [{ type: "text" as const, text: "Pipeline requires either LORE_DB_HOST (direct) or LORE_API_URL + LORE_INGEST_TOKEN (remote). Set one in your environment." }] };
        }
        const res = await fetch(`${apiUrl}/api/task`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc, task_type, target_repo, context }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Remote task creation failed: ${(err as any).error || res.statusText}` }] };
        }
        const result = await res.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }

      const validTypes = getTaskTypes();
      const resolvedType = validTypes.includes(task_type) ? task_type : "general";
      const result = await createTask(desc, resolvedType, target_repo, "mcp", context || undefined);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...result, task_type: resolvedType, target_repo: target_repo || result.target_repo }) }] };
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
        return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const task = await getTask(task_id);
      if (!task) {
        return { content: [{ type: "text" as const, text: `task not found: ${task_id}` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error fetching pipeline status: ${err.message}` }] };
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
        return { content: [{ type: "text" as const, text: "Pipeline requires PostgreSQL (LORE_DB_HOST not set)." }] };
      }
      const validStatuses = ["pending", "queued", "running", "pr-created", "review", "merged", "failed", "cancelled"];
      if (status && !validStatuses.includes(status)) {
        return { content: [{ type: "text" as const, text: `invalid status: ${status}. Valid values: ${validStatuses.join(", ")}` }] };
      }
      const clampedLimit = Math.min(limit, 100);
      const result = await listTasks(status, clampedLimit);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error listing pipeline tasks: ${err.message}` }] };
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

  // Initialize pipeline config (task CRUD only — processing moved to lore-agent service)
  loadTaskTypes();
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
        // Check if a repo is onboarded — used by the status line cache
        const url = new URL(req.url, `http://${req.headers.host}`);
        const repo = url.searchParams.get("repo");
        if (!repo || !dbPoolRef) {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ onboarded: false }));
          return;
        }
        try {
          const { rows } = await dbPoolRef.query(`SELECT 1 FROM lore.repos WHERE full_name = $1`, [repo]);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ onboarded: rows.length > 0, repo }));
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ onboarded: false }));
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
      } else if (req.url === "/api/task" && req.method === "POST") {
        // Create pipeline task via REST — used by local MCP servers to delegate work
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
            const { description, task_type, target_repo, context } = JSON.parse(body);
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
