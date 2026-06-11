import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { getQueryEmbedding } from "../../platform/db.js";
import { resolveAgentId } from "../../platform/agent-id.js";
import {
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
  isMemoryDbAvailable,
  agentHealth,
  agentStats,
} from "../../features/memory/memory.js";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "../../features/memory/memory-file.js";
import { searchMemories } from "../../features/memory/memory-search.js";
import { extractFacts, extractFactsFromEpisode } from "../../features/memory/facts.js";
import { extractAndUpdateGraph, queryLiveGraph } from "../../features/memory/graph.js";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { createGraphLlmCall } from "../../platform/anthropic-client.js";
import {
  ToolDeps,
  makeTrackLatency,
  proxyMemory,
  proxyToApi,
  proxyGetApi,
  unreachableError,
} from "./deps.js";

export function registerMemoryTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;
  const trackLatency = makeTrackLatency(getPool);

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
            import("../../features/memory/memory.js").then(({ getMemoryPool }) => {
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
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("write_memory", proxied.detail);
        // File fallback only when LORE_API_URL is not configured (true offline mode)
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
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("read_memory", proxied.detail);
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
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("delete_memory", proxied.detail);
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
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("list_memories", proxied.detail);
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
            getPool(),
            query, agent_id, pool, limit, include_invalidated, graph_augment
          );
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        }
        const proxied = await proxyMemory("search", { query, agent_id: agent_id || undefined, pool_name: pool, limit });
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("search_memory", proxied.detail);
        const results = await searchMemoryFile(query, agent_id, limit);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error searching memories: ${err.message}` }] };
      }
    }
  );

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
        const dbPoolRef = getPool();
        if (!isMemoryDbAvailable()) {
          // Proxy to GKE
          const proxied = await proxyToApi("/api/episode", {
            content, source, ref, agent_id: agent_id || resolveAgentId(),
          });
          if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
          if (proxied.reason === "unreachable") return unreachableError("write_episode", proxied.detail);
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
          const graphLlmCall = createGraphLlmCall(dbPoolRef);
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
            // Local stdio mode: proxy the read to the GKE server over LORE_API_URL
            // (mirrors assemble_context) instead of requiring a direct DB.
            const params = new URLSearchParams();
            if (entity) params.set("entity", entity);
            if (relation_type) params.set("relation_type", relation_type);
            if (repo) params.set("repo", repo);
            if (include_invalidated) params.set("include_invalidated", "true");
            const proxied = await proxyGetApi(`/api/graph?${params.toString()}`);
            if (proxied.ok) {
              return { content: [{ type: "text" as const, text: proxied.body }] };
            }
            if (proxied.reason === "unreachable") {
              return unreachableError("query_graph", proxied.detail);
            }
            return { content: [{ type: "text" as const, text: "Knowledge graph requires PostgreSQL (LORE_DB_HOST) or a configured LORE_API_URL." }] };
          }
          const results = await queryLiveGraph(getPool(), entity, relation_type, repo, include_invalidated);
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
        const dbPoolRef = getPool();
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
}
