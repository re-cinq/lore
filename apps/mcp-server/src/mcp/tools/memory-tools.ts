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
  withReadCache,
  unreachableError,
  deniedError,
} from "./deps.js";
import { invalidate as invalidateCache } from "../../platform/proxy-cache.js";

// Reads whose results a memory/episode write can change. Over-invalidating is
// safe — it only forces the next read to re-fetch.
const MEMORY_DERIVED_READS = ["lore_search_memory", "lore_read_memory", "lore_list_memories", "lore_assemble_context"];
const EPISODE_DERIVED_READS = ["lore_search_memory", "lore_query_graph", "lore_assemble_context"];

export function registerMemoryTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;
  const trackLatency = makeTrackLatency(getPool);

  server.tool(
    "lore_write_memory",
    `Stores one curated, addressable key/value memory scoped to the auto-detected current repo (or, when no repo is detected, scoped to the agent_id instead of a repo) and returns the write result {key, version, agent_id, created_at}. Writes are versioned (a repeat key bumps version, never overwrites) and, when a repo is detected, shared org-wide with every developer in the same repo; with no repo detected the memory is agent-scoped (not repo-shared). Use this when you have a nugget you want to retrieve later by a key YOU choose — a decision, convention, correction, or session summary. For raw uncurated text you want passively stored with auto fact-extraction and no chosen key, use lore_write_episode instead. This is a WRITE: it embeds the value, invalidates memory-derived read caches (search/read/list/assemble), and runs against the local DB when LORE_DB_HOST is set, else proxies to /api/memory over LORE_API_URL (write scope), with a ~/.lore file fallback only when no API is configured.`,
    {
      key: z.string().describe("Caller-chosen retrieval key, slash-namespaced by convention. Required. Example: 'auth-pattern' or 'session-summary/2026-03-30'."),
      value: z.string().describe("The memory text to store; this exact string is the canonical stored value and is embedded for semantic search. Required. Example: 'Auth tokens are validated in middleware/auth.ts, never in route handlers.'"),
      agent_id: z.string().optional().describe("Override the resolved agent ID for this write. Omit to use the ambient agent (LORE_AGENT_ID env / ~/.lore/agent-id). Example: 'agent-ci-bot'."),
      ttl: z.number().optional().describe("Time-to-live in seconds; sets expires_at relative to now. Omit for a permanent memory (no expiry). Example: 86400 for one day."),
      extract_facts: z.boolean().optional().describe("When true, fire async fact extraction from value (fire-and-forget, does not block the response). Omit/false to store the memory only. Example: true."),
    },
    async ({ key, value, agent_id, ttl, extract_facts }) => {
      try {
        const repo = detectCurrentRepo() || undefined;
        const embedding = await getQueryEmbedding(value);
        if (isMemoryDbAvailable()) {
          const result = await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo);
          invalidateCache(MEMORY_DERIVED_READS);
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
    `Fetches one memory by its EXACT key and returns the stored row as JSON (latest non-deleted version by default; the full version history or a single past version on request). Use this only when you already know the precise key. If you are searching by meaning or do not know the key, use lore_search_memory; to enumerate keys for the current repo, use lore_list_memories. Returns the matched row(s), or the text 'Memory "<key>" not found.' when the key has no live version. This is a read: it runs against the local DB when LORE_DB_HOST is set, else a short-TTL (~5min) cached proxy to /api/memory over LORE_API_URL (read scope), with a ~/.lore file fallback when no API is configured.`,
    {
      key: z.string().describe("Exact memory key to read; no wildcards or fuzzy matching. Required. Example: 'auth-pattern'."),
      agent_id: z.string().optional().describe("Override the resolved agent ID. Omit to use the ambient agent. Example: 'agent-ci-bot'."),
      version: z.string().optional().describe('Which version to return: "all" for the full history newest-first, or a numeric version string for one specific version. Omit for the latest non-deleted version. Examples: "all", "3".'),
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
    `Soft-deletes a memory by key for the resolved agent and returns {key, deleted: true}. Soft-delete flips is_deleted on every version row of that agent+key so it stops appearing in lore_read_memory, lore_list_memories, and lore_search_memory, while version history (memory.memory_versions) is kept intact — this is not a hard purge and there is no restore here. Scope is agent_id, NOT repo. Use this to retire a stale or mistaken memory; to remove a background task running on your own machine use lore_cancel_local_task, and to cancel a server-side pipeline task use lore_cancel_task — those are unrelated. This is a WRITE: it invalidates memory-derived read caches, runs against the local DB when LORE_DB_HOST is set, else proxies to /api/memory over LORE_API_URL (write scope), with a ~/.lore file fallback when no API is configured.`,
    {
      key: z.string().describe("Exact memory key to soft-delete. Required. Example: 'session-summary/2026-03-30'."),
      agent_id: z.string().optional().describe("Override the resolved agent ID; deletion is scoped to this agent and key. Omit to use the ambient agent. Example: 'agent-ci-bot'."),
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
    `Lists memory keys for the auto-detected current repo, newest-first and paginated, returning {memories: [{key, agent_id, repo, version, created_at, ttl_seconds, has_facts}], total}. Expired and soft-deleted memories are excluded. Scope precedence: the detected repo wins; with no repo it falls back to the given agent_id; with neither it lists org-wide. Use this to browse what memories exist by key without ranking. To find memories by meaning rather than enumerate them, use lore_search_memory; to fetch one specific memory's value, use lore_read_memory. This is a read: it runs against the local DB when LORE_DB_HOST is set, else a short-TTL (~5min) cached proxy to /api/memory over LORE_API_URL (read scope; offset is not forwarded over the proxy), with a ~/.lore file fallback when no API is configured.`,
    {
      agent_id: z.string().optional().describe("Agent to scope to when no repo is detected (ignored when a repo is detected, since repo scope wins). Omit for repo or org-wide scope. Example: 'agent-ci-bot'."),
      limit: z.number().default(50).describe("Maximum number of memories to return. Defaults to 50 when omitted. Example: 100."),
      offset: z.number().default(0).describe("Number of rows to skip for pagination (DB path only; not forwarded over the proxy). Defaults to 0 when omitted. Example: 50 for the second page of 50."),
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
    `Semantic (vector + keyword) search across org-wide memories and extracted facts, returning a relevance-ranked JSON array of {key, value, score, agent_id, source, id?, confidence?} where source is memory|fact|episode|graph. Only currently-valid facts are returned unless include_invalidated is set. Use this to find past learnings, decisions, corrections, and facts from prior sessions — 'has this been solved or observed before' — when you do NOT have an exact key. For an exact-key lookup use lore_read_memory; to enumerate keys for the current repo use lore_list_memories; to retrieve raw repo document passages (conventions, ADRs, .md text) use lore_search_context; to traverse entity relationships use lore_query_graph; to get the single token-budgeted startup bundle (conventions + ADRs + memories + facts + graph) rather than a raw ranked list, use lore_assemble_context (the mandatory first call). This is a read with a retrieval-strengthening side effect (fire-and-forget bump of retrieval_count / half_life_days on returned items): it runs against the local DB when LORE_DB_HOST is set, else a short-TTL (~5min) cached proxy to /api/memory over LORE_API_URL (read scope; pool maps to pool_name, and include_invalidated / graph_augment are not forwarded), with a ~/.lore file fallback when no API is configured.`,
    {
      query: z.string().describe("Natural-language search query; matched by embedding similarity and keyword ILIKE, not exact key. Required. Example: 'how do we handle auth token refresh'."),
      agent_id: z.string().optional().describe("Scope results to one agent. Omit for cross-agent (org-wide) search. Example: 'agent-ci-bot'."),
      pool: z.string().optional().describe("Restrict the search to a named shared pool; a non-existent pool name short-circuits to an empty result. Omit to search outside any pool. Example: 'platform-team'."),
      limit: z.number().default(10).describe("Maximum number of fused results to return after rank fusion and diversification. Defaults to 10 when omitted. Example: 25."),
      include_invalidated: z.boolean().default(false).describe("When true, also return facts that have been superseded by newer facts (historical queries). Defaults to false (currently-valid facts only). Example: true."),
      graph_augment: z.boolean().default(false).describe("When true, enrich results with 1-hop knowledge-graph neighbors of entities detected in the matches. Defaults to false. Example: true."),
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
    `Ingests one raw, uncurated text blob (a conversation turn, code review, or observation) as a deduplicated episode and returns {status: "ok", episode_id, source, ref} — or {status: "duplicate", ...} when the same content was already ingested. Content is secret-redacted before storage, then facts (≤10) and knowledge-graph entities/edges are extracted ASYNCHRONOUSLY (the response does not wait for them). Use this for bulk/passive capture where you do NOT want to choose a key and do NOT need the text individually addressable. For a curated nugget you want to retrieve later by a specific key, use lore_write_memory instead. This is a WRITE: it invalidates episode-derived read caches (search/graph/assemble), runs against the local DB when LORE_DB_HOST is set, else proxies to /api/episode over LORE_API_URL (write scope); with neither configured it returns a 'requires PostgreSQL or LORE_API_URL' message rather than a file fallback.`,
    {
      content: z.string().min(1).max(50000).describe("Raw text to ingest verbatim (conversation, review, observation); deduplicated by content hash. Required, 1–50000 chars. Example: 'Reviewed PR #42 — the retry backoff was doubling on every 5xx, fixed to cap at 30s.'"),
      source: z.string().default("manual").describe('Free-form source tag for provenance. Defaults to "manual" when omitted. Common values: "session", "pr-review", "ci", "manual".'),
      ref: z.string().optional().describe('External reference; the leading owner/repo before any # is used as the graph repo scope. Omit if none. Example: "owner/repo#42".'),
      agent_id: z.string().optional().describe("Override the resolved agent ID for this episode. Omit to use the ambient agent. Example: 'agent-ci-bot'."),
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
    `Reads the live knowledge graph and returns a JSON array of typed relationship edges {entity, entity_type, relation, related_entity, related_type, direction (outgoing|incoming), valid_from} for one entity, or recent edges when no entity is given. Use this when you want STRUCTURED relationships — which service uses/owns/depends-on/replaced-by which — not prose. For learnings, decisions, and facts in prose form use lore_search_memory; for raw document passages use lore_search_context; for the token-budgeted startup bundle use lore_assemble_context. Returns matching edges, or 'No relationships found for "<entity>".' / 'Knowledge graph is empty...' when there are none. Read-only (no graph writes here; the graph is populated asynchronously by lore_write_episode). Runs against the local DB when LORE_DB_HOST is set, else a short-TTL (~10min) cached proxy to GET /api/graph over LORE_API_URL (read scope); with neither configured it returns a 'requires PostgreSQL or LORE_API_URL' message.`,
    {
      entity: z.string().optional().describe("Entity name to query; case-insensitive, matched against both edge endpoints. Omit to browse the most recent edges across the graph. Example: 'auth-service' or 'postgres'."),
      relation_type: z.string().optional().describe('Restrict to one relation type. Omit for all relations. Known values: "uses", "owns", "depends-on", "replaced-by", "part-of", "implements".'),
      repo: z.string().optional().describe("Scope edges to a specific repo; only edges whose repo equals this value match (repo-less/NULL edges are excluded when set). Omit for all repos. Example: 're-cinq/lore'."),
      include_invalidated: z.boolean().default(false).describe("When true, also include historical (temporally-invalidated) edges. Defaults to false (currently-valid edges only). Example: true."),
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
    `Returns one agent's combined health and learning statistics as JSON: agent_id, memory_count, last_active, snapshot_count, total_memories, total_facts, active_facts, invalidated_facts, total_searches, shared_pools_created, and recent_episodes {total_count, latest: [{id, source, ref, created_at, content_preview, fact_count}]}. Use this to gauge how much an agent has learned and how active it is (diagnosing a quiet or runaway agent). This is read-only memory telemetry, distinct from lore_my_usage, which reports per-developer LLM token spend. REQUIRES a direct database connection (LORE_DB_HOST): unlike the other memory tools it does NOT proxy to LORE_API_URL — with no DB it returns 'Agent stats requires PostgreSQL (LORE_DB_HOST not set).'`,
    {
      agent_id: z.string().optional().describe("Override the resolved agent ID to inspect a specific agent. Omit to report on the ambient agent (LORE_AGENT_ID env / ~/.lore/agent-id). Example: 'agent-ci-bot'."),
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
