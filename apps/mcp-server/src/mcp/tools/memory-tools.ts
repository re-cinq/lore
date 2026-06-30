import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import { resolveAgentId } from "@re-cinq/lore-server-core/platform/agent-id.js";
import {
  writeMemory,
  readMemory,
  deleteMemory,
  listMemories,
  isMemoryDbAvailable,
  agentHealth,
  agentStats,
} from "@re-cinq/lore-server-core/features/memory/memory.js";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  listMemoriesFile,
  searchMemoryFile,
} from "@re-cinq/lore-server-core/features/memory/memory-file.js";
import { searchMemories } from "@re-cinq/lore-server-core/features/memory/memory-search.js";
import { extractFacts, extractFactsFromEpisode } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractAndUpdateGraph, queryLiveGraph } from "@re-cinq/lore-server-core/features/memory/graph.js";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import { createGraphLlmCall } from "@re-cinq/lore-server-core/platform/anthropic-client.js";
import {
  ToolDeps,
  makeTrackLatency,
  proxyMemory,
  proxyToApi,
  proxyGetApi,
  withReadCache,
  unreachableError,
  deniedError,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";

// Reads whose results a memory/episode write can change. Over-invalidating is
// safe — it only forces the next read to re-fetch.
const MEMORY_DERIVED_READS = ["lore_search_memory", "lore_read_memory", "lore_list_memories", "lore_assemble_context"];
const EPISODE_DERIVED_READS = ["lore_search_memory", "lore_query_graph", "lore_assemble_context"];

export function registerMemoryTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;
  const trackLatency = makeTrackLatency(getPool);

  server.tool(
    "lore_write_memory",
    `Stores one curated key/value memory (versioned, repo-scoped when a repo is detected, agent-scoped otherwise) and returns {key, version, agent_id, created_at}. Use when you have a decision, convention, correction, or session summary you want to retrieve later by a key you choose. Instead: lore_write_episode for raw uncurated text with no chosen key.`,
    {
      key: z.string().describe("Caller-chosen retrieval key; slash-namespaced by convention, e.g. 'session-summary/2026-03-30'."),
      value: z.string(),
      agent_id: z.string().optional(),
      ttl: z.number().optional().describe("Time-to-live in seconds. Omit for no expiry."),
      extract_facts: z.boolean().optional().describe("When true, triggers async fact extraction from value (fire-and-forget)."),
    },
    async ({ key, value, agent_id, ttl, extract_facts }) => {
      try {
        const repo = detectCurrentRepo() || undefined;
        const embedding = await getQueryEmbedding(value);
        if (isMemoryDbAvailable()) {
          const result = await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo);
          invalidateCache(MEMORY_DERIVED_READS);
          if (extract_facts) {
            import("@re-cinq/lore-server-core/features/memory/memory.js").then(({ getMemoryPool }) => {
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
        if (proxied.ok) {
          invalidateCache(MEMORY_DERIVED_READS);
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }
        if (proxied.reason === "unreachable") return unreachableError("lore_write_memory", proxied.detail);
        if (proxied.reason === "denied") return deniedError("lore_write_memory", proxied.detail);
        // File fallback only when LORE_API_URL is not configured (true offline mode)
        const result = await writeMemoryFile(key, value, agent_id, ttl);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error writing memory: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_read_memory",
    `Fetches one memory by its exact key and returns the stored row as JSON (latest version by default, or full history/specific version on request). Use only when you already know the precise key. Instead: lore_search_memory when searching by meaning; lore_list_memories to enumerate keys.`,
    {
      key: z.string().describe("Exact memory key; no wildcards or fuzzy matching."),
      agent_id: z.string().optional(),
      version: z.string().optional().describe('"all" for full history newest-first, or a numeric string for one specific version. Omit for the latest non-deleted version.'),
    },
    async ({ key, agent_id, version }) => {
      try {
        const ver = version === "all" ? "all" : version ? Number(version) : undefined;
        if (isMemoryDbAvailable()) {
          const result = await readMemory(key, agent_id, ver);
          if (!result) return { content: [{ type: "text" as const, text: `Memory "${key}" not found.` }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        }
        const proxied = await withReadCache(
          { tool: "lore_read_memory", args: { key, agent_id: agent_id || resolveAgentId(), version }, ttlSeconds: 300 },
          () => proxyMemory("read", { key, agent_id: agent_id || resolveAgentId(), version }),
        );
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("lore_read_memory", proxied.detail);
        if (proxied.reason === "denied") return deniedError("lore_read_memory", proxied.detail);
        const result = await readMemoryFile(key, agent_id, ver);
        if (!result) return { content: [{ type: "text" as const, text: `Memory "${key}" not found.` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error reading memory: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_delete_memory",
    `Soft-deletes a memory by key (hides it from read/list/search; version history is retained) and returns {key, deleted: true}. Scope is agent_id, not repo. Use to retire a stale or mistaken memory. Instead: lore_cancel_local_task to stop a local background task; lore_cancel_task to cancel a pipeline task — those are unrelated.`,
    {
      key: z.string().describe("Exact memory key to soft-delete."),
      agent_id: z.string().optional(),
    },
    async ({ key, agent_id }) => {
      try {
        if (isMemoryDbAvailable()) {
          const result = await deleteMemory(key, agent_id);
          invalidateCache(MEMORY_DERIVED_READS);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        }
        const proxied = await proxyMemory("delete", { key, agent_id: agent_id || resolveAgentId() });
        if (proxied.ok) {
          invalidateCache(MEMORY_DERIVED_READS);
          return { content: [{ type: "text" as const, text: proxied.body }] };
        }
        if (proxied.reason === "unreachable") return unreachableError("lore_delete_memory", proxied.detail);
        if (proxied.reason === "denied") return deniedError("lore_delete_memory", proxied.detail);
        const result = await deleteMemoryFile(key, agent_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error deleting memory: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_list_memories",
    `Lists memory keys for the current repo (newest-first, paginated), returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Scope: detected repo wins; falls back to agent_id; then org-wide. Excludes expired and soft-deleted entries. Use to browse existing keys without ranking. Instead: lore_search_memory to find memories by meaning; lore_read_memory to fetch one specific value.`,
    {
      agent_id: z.string().optional().describe("Agent scope when no repo is detected (ignored when repo is detected)."),
      limit: z.number().default(50),
      offset: z.number().default(0).describe("Rows to skip for pagination (DB path only; not forwarded over proxy)."),
    },
    async ({ agent_id, limit, offset }) => {
      try {
        const repo = detectCurrentRepo() || undefined;
        if (isMemoryDbAvailable()) {
          const result = await listMemories(agent_id, limit, offset, repo);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        }
        const proxied = await withReadCache(
          { tool: "lore_list_memories", args: { agent_id: agent_id || undefined, limit, repo }, repo: repo || undefined, ttlSeconds: 300 },
          () => proxyMemory("list", { agent_id: agent_id || undefined, limit, repo }),
        );
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("lore_list_memories", proxied.detail);
        if (proxied.reason === "denied") return deniedError("lore_list_memories", proxied.detail);
        const result = await listMemoriesFile(agent_id, limit, offset);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error listing memories: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_search_memory",
    `Semantic (vector + keyword) search across org-wide memories and extracted facts; returns a relevance-ranked array of {key, value, score, agent_id, source, id?, confidence?} (source: memory|fact|episode|graph). Use to find past learnings, decisions, corrections, and facts when you do NOT have an exact key. Instead: lore_read_memory for exact-key lookup; lore_list_memories to enumerate keys; lore_search_context for raw repo document passages (conventions, ADRs, .md text); lore_query_graph to traverse entity relationships; lore_assemble_context for the token-budgeted startup bundle (the mandatory first call).`,
    {
      query: z.string(),
      agent_id: z.string().optional().describe("Scope to one agent. Omit for org-wide search."),
      pool: z.string().optional().describe("Restrict to a named shared pool; non-existent pool name returns empty."),
      limit: z.number().default(10),
      include_invalidated: z.boolean().default(false).describe("When true, also return superseded/historical facts."),
      graph_augment: z.boolean().default(false).describe("When true, enrich results with 1-hop knowledge-graph neighbors."),
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
        const proxied = await withReadCache(
          { tool: "lore_search_memory", args: { query, agent_id: agent_id || undefined, pool_name: pool, limit }, ttlSeconds: 300 },
          () => proxyMemory("search", { query, agent_id: agent_id || undefined, pool_name: pool, limit }),
        );
        if (proxied.ok) return { content: [{ type: "text" as const, text: proxied.body }] };
        if (proxied.reason === "unreachable") return unreachableError("lore_search_memory", proxied.detail);
        if (proxied.reason === "denied") return deniedError("lore_search_memory", proxied.detail);
        const results = await searchMemoryFile(query, agent_id, limit);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error searching memories: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_write_episode",
    `Ingests one raw uncurated text blob as a deduplicated episode; returns {status: "ok", episode_id, source, ref} or {status: "duplicate"} when already ingested. Content is secret-redacted; facts and graph entities/edges are extracted asynchronously. Use for bulk/passive capture where you do not want to choose a key and do not need the text individually addressable. Instead: lore_write_memory for a curated nugget you want to retrieve by a specific key. No file fallback — requires DB or API.`,
    {
      content: z.string().min(1).max(50000).describe("Raw text to ingest; deduplicated by content hash. 1–50000 chars."),
      source: z.string().default("manual").describe('Provenance tag, e.g. "session", "pr-review", "ci".'),
      ref: z.string().optional().describe('External reference, e.g. "owner/repo#42". The owner/repo prefix scopes graph entities.'),
      agent_id: z.string().optional(),
    },
    async ({ content, source, ref, agent_id }) => {
      try {
        const dbPoolRef = getPool();
        if (!isMemoryDbAvailable()) {
          // Proxy to GKE
          const proxied = await proxyToApi("/api/episode", {
            content, source, ref, agent_id: agent_id || resolveAgentId(),
          });
          if (proxied.ok) {
            invalidateCache(EPISODE_DERIVED_READS);
            return { content: [{ type: "text" as const, text: proxied.body }] };
          }
          if (proxied.reason === "unreachable") return unreachableError("lore_write_episode", proxied.detail);
          if (proxied.reason === "denied") return deniedError("lore_write_episode", proxied.detail);
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
        invalidateCache(EPISODE_DERIVED_READS);

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
           VALUES ($1, 'lore_write_episode', $2)`,
          [agent, JSON.stringify({ episode_id: episodeId, source, ref })],
        ).catch(() => {});

        return { content: [{ type: "text" as const, text: JSON.stringify({ status: "ok", episode_id: episodeId, source, ref }) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error writing episode: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_query_graph",
    `Reads the live knowledge graph and returns typed relationship edges {entity, entity_type, relation, related_entity, related_type, direction, valid_from} for one entity, or recent edges when no entity given. Use when you want structured relationships (uses/owns/depends-on/replaced-by), not prose. Graph is populated asynchronously by lore_write_episode — no writes here. Instead: lore_search_memory for learnings and facts in prose form; lore_search_context for raw document passages; lore_assemble_context for the token-budgeted startup bundle.`,
    {
      entity: z.string().optional().describe("Entity name (case-insensitive); matched against both edge endpoints. Omit to browse recent edges."),
      relation_type: z.string().optional().describe('Filter to one relation type, e.g. "uses", "owns", "depends-on", "replaced-by", "part-of", "implements".'),
      repo: z.string().optional().describe('Scope to a specific repo, e.g. "re-cinq/lore". Repo-less edges excluded when set.'),
      include_invalidated: z.boolean().default(false).describe("When true, also include historically-invalidated edges."),
    },
    async ({ entity, relation_type, repo, include_invalidated }) => {
      return trackLatency('lore_query_graph', async () => {
        try {
          if (!isMemoryDbAvailable()) {
            // Local stdio mode: proxy the read to the GKE server over LORE_API_URL
            // (mirrors lore_assemble_context) instead of requiring a direct DB.
            const params = new URLSearchParams();
            if (entity) params.set("entity", entity);
            if (relation_type) params.set("relation_type", relation_type);
            if (repo) params.set("repo", repo);
            if (include_invalidated) params.set("include_invalidated", "true");
            const proxied = await withReadCache(
              { tool: "lore_query_graph", args: { entity, relation_type, repo, include_invalidated }, repo: repo || undefined, ttlSeconds: 600 },
              () => proxyGetApi(`/api/graph?${params.toString()}`),
            );
            if (proxied.ok) {
              return { content: [{ type: "text" as const, text: proxied.body }] };
            }
            if (proxied.reason === "unreachable") {
              return unreachableError("lore_query_graph", proxied.detail);
            }
            if (proxied.reason === "denied") {
              return deniedError("lore_query_graph", proxied.detail);
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
    "lore_agent_stats",
    `Returns an agent's combined health and learning statistics as JSON (memory_count, total_facts, active_facts, invalidated_facts, total_searches, recent_episodes, etc.). Use to gauge how much an agent has learned and how active it is. (DB-only — does not proxy.) Instead: lore_my_usage for per-developer LLM token spend.`,
    {
      agent_id: z.string().optional().describe("Agent to inspect. Omit for the ambient agent."),
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
